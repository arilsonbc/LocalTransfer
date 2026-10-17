export type Room = {
  code: string; host_token: string; guest_token: string | null;
  host_name: string; guest_name: string | null;
  offer: string | null; answer: string | null; expires_at: number;
};
export interface RoomStore {
  create(room: Room): Promise<boolean>;
  get(code: string): Promise<Room | null>;
  join(code: string, tokenHash: string, name: string): Promise<Room | null>;
  signal(code: string, role: "host" | "guest", tokenHash: string, description: string): Promise<boolean>;
  remove(code: string, tokenHash: string): Promise<boolean>;
  allow(key: string, maximum: number): Promise<boolean>;
}

// Lua makes claims/updates atomic across separate Vercel Function instances.
export const JOIN_SCRIPT = `
local raw=redis.call('GET',KEYS[1]); if not raw then return false end
local room=cjson.decode(raw)
if room.expires_at<=tonumber(ARGV[3]) or room.guest_token~=cjson.null then return false end
room.guest_token=ARGV[1];room.guest_name=ARGV[2]
redis.call('SET',KEYS[1],cjson.encode(room),'PX',room.expires_at-tonumber(ARGV[3]))
return cjson.encode(room)`;
export const SIGNAL_SCRIPT = `
local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
local room=cjson.decode(raw)
if room.expires_at<=tonumber(ARGV[4]) or room[ARGV[1]..'_token']~=ARGV[2] then return 0 end
local field='offer';if ARGV[1]=='guest' then field='answer' end
room[field]=ARGV[3]
redis.call('SET',KEYS[1],cjson.encode(room),'PX',room.expires_at-tonumber(ARGV[4]))
return 1`;
export const DELETE_SCRIPT = `
local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
local room=cjson.decode(raw)
if room.host_token~=ARGV[1] and room.guest_token~=ARGV[1] then return 0 end
return redis.call('DEL',KEYS[1])`;
export const LIMIT_SCRIPT = `
local count=redis.call('INCR',KEYS[1]);if count==1 then redis.call('EXPIRE',KEYS[1],120) end
return count`;

export class RedisRoomStore implements RoomStore {
  constructor(private url: string, private token: string) {
    if (new URL(url).protocol !== "https:") throw new Error("Redis requires HTTPS.");
  }
  private key(code: string) { return `localtransfer:room:${code}`; }
  private async command<T>(...command: (string | number)[]): Promise<T> {
    const response = await fetch(this.url, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(command),
    });
    const data = await response.json() as { result?: T; error?: string };
    // Never expose provider responses: they can contain deployment details.
    if (!response.ok || data.error || !("result" in data)) throw new Error("Room storage unavailable.");
    return data.result as T;
  }
  async create(room: Room) {
    const ttl = room.expires_at - Date.now();
    if (ttl <= 0) return false;
    return await this.command("SET", this.key(room.code), JSON.stringify(room), "PX", ttl, "NX") === "OK";
  }
  async get(code: string) {
    const raw = await this.command<string | null>("GET", this.key(code));
    if (!raw) return null;
    const room = JSON.parse(raw) as Room;
    return room.expires_at > Date.now() ? room : null;
  }
  async join(code: string, tokenHash: string, name: string) {
    const raw = await this.command<string | null>("EVAL", JOIN_SCRIPT, 1, this.key(code), tokenHash, name, Date.now());
    return raw ? JSON.parse(raw) as Room : null;
  }
  async signal(code: string, role: "host" | "guest", tokenHash: string, description: string) {
    return await this.command("EVAL", SIGNAL_SCRIPT, 1, this.key(code), role, tokenHash, description, Date.now()) === 1;
  }
  async remove(code: string, tokenHash: string) {
    return await this.command("EVAL", DELETE_SCRIPT, 1, this.key(code), tokenHash) === 1;
  }
  async allow(key: string, maximum: number) {
    return await this.command<number>("EVAL", LIMIT_SCRIPT, 1, `localtransfer:limit:${key}`) <= maximum;
  }
}

export function getRoomStore(): RoomStore {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Room storage is not configured.");
  return new RedisRoomStore(url, token);
}
