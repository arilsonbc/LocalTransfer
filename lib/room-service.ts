export const ROOM_TTL = 20 * 60 * 1000;
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

export function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[\s-]/g, "");
}
export function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, n => alphabet[n % alphabet.length]).join("");
}
export function makeToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("");
}
export async function hash(value: string) {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(data), n => n.toString(16).padStart(2, "0")).join("");
}
export function deviceName(value: unknown) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 48) || "Dispositivo" : "Dispositivo";
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {status, headers:{"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"}});
}
export function validOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 48000) throw new Error("Solicitação muito grande.");
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Solicitação inválida.");
  return data;
}
export async function allowed(db: D1Database, request: Request, action: string, max: number) {
  const now = Date.now();
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const key = await hash(`${ip}:${action}:${Math.floor(now / 60000)}`);
  const row = await db.prepare(`INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`).bind(key, now + 120000).first<{count:number}>();
  return !!row && row.count <= max;
}
export type RoomRow = {code:string;host_token:string;guest_token:string|null;host_name:string;guest_name:string|null;offer:string|null;answer:string|null;expires_at:number};
export async function authenticate(db: D1Database, code: string, request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await db.prepare("SELECT * FROM rooms WHERE code=? AND expires_at>?").bind(code, Date.now()).first<RoomRow>();
  if (!row) return null;
  const digest = await hash(token);
  const role = digest === row.host_token ? "host" : digest === row.guest_token ? "guest" : null;
  return role ? {row, role} : null;
}
