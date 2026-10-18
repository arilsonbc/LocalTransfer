export async function generateIceServers(): Promise<RTCIceServer[]> {
  const key = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!key && !token) return [{urls:"stun:stun.cloudflare.com:3478"}];
  if (!key || !token) throw new Error("TURN configuration incomplete");
  const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(key)}/credentials/generate-ice-servers`, {
    method:"POST", cache:"no-store", signal:AbortSignal.timeout(10000),
    headers:{Authorization:`Bearer ${token}`, "Content-Type":"application/json"},
    // A 100 GB transfer may take many hours on a mobile connection.
    body:JSON.stringify({ttl:172800}),
  });
  if (!response.ok) throw new Error("TURN credentials unavailable");
  const data = await response.json() as {iceServers?:RTCIceServer[]};
  if (!Array.isArray(data.iceServers)) throw new Error("Invalid TURN response");
  const relay=data.iceServers.find(server=>server.username && server.credential &&
    (Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>typeof url==="string" && /^turns?:/.test(url)));
  if(!relay)throw new Error("Missing TURN credentials");
  // A single TLS endpoint avoids waiting on UDP/alternate ports on mobile networks.
  // Credentials issued for Cloudflare TURN work across its documented endpoints.
  return [
    {urls:"stun:stun.cloudflare.com:3478"},
    {urls:"turns:turn.cloudflare.com:443?transport=tcp",username:relay.username,credential:relay.credential},
  ];
}
