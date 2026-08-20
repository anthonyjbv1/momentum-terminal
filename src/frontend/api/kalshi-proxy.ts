export const config = { runtime: "edge" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { searchParams } = new URL(request.url);
  const upstream = new URL("https://api.elections.kalshi.com/trade-api/v2/markets");
  searchParams.forEach((value, key) => upstream.searchParams.set(key, value));

  try {
    const resp = await fetch(upstream.toString(), {
      headers: { "Content-Type": "application/json" },
    });
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: {
        "Content-Type": resp.headers.get("Content-Type") ?? "application/json",
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
