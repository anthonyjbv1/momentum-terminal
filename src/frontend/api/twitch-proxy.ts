export const config = { runtime: "edge" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// In-memory token cache (edge function lifetime — resets on cold start)
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const resp = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!resp.ok) throw new Error(`Twitch token error ${resp.status}`);
  const data = await resp.json() as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  // Expire 60s early to avoid using a token right at its boundary
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // POST — return access token
  if (request.method === "POST") {
    try {
      const { clientId, clientSecret } = await request.json() as { clientId: string; clientSecret: string };
      const token = await getToken(clientId, clientSecret);
      return new Response(JSON.stringify({ access_token: token }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }
  }

  // GET — proxy to Helix
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");
  const clientId = searchParams.get("clientId") ?? "";
  const token = searchParams.get("token") ?? "";

  if (!endpoint) {
    return new Response(JSON.stringify({ error: "Missing endpoint parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  try {
    const upstream = await fetch(`https://api.twitch.tv/helix/${endpoint}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Client-Id": clientId,
      },
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        ...CORS,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
}
