import type { RoomStore } from "./room-store";
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
export async function allowed(store: RoomStore, request: Request, action: string, max: number, windowSeconds=60) {
  const now = Date.now();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = await hash(`${ip}:${action}:${Math.floor(now / (windowSeconds*1000))}`);
  return store.allow(key, max,windowSeconds*2);
}
export async function authenticate(store: RoomStore, code: string, request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await store.get(code);
  if (!row) return null;
  const digest = await hash(token);
  const role = digest === row.host_token ? "host" : digest === row.guest_token ? "guest" : null;
  return role ? {row, role, digest} : null;
}
