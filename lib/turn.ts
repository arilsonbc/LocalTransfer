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
  // Port 53 is blocked by browsers and delays non-trickle ICE gathering.
  const servers = data.iceServers.map(server => ({...server, urls:
    (Array.isArray(server.urls)?server.urls:[server.urls]).filter(url =>
      typeof url === "string" && /^(stun|turn|turns):/.test(url) && !/:53(?:\?|$)/.test(url))
  })).filter(server => server.urls.length);
  if (!servers.some(server => server.urls.some(url => /^turns?:/.test(url)) && server.username && server.credential)) {
    throw new Error("Missing TURN credentials");
  }
  return servers;
}
