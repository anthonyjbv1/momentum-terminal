export const config = { runtime: "edge" };

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: "Missing url parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const fetchOptions: RequestInit = {
    method: request.method,
    headers: {
      "User-Agent": "MomentumTerminal/1.0",
      "Accept": "application/json",
      ...(request.headers.get("Content-Type")
        ? { "Content-Type": request.headers.get("Content-Type")! }
        : {}),
    },
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    fetchOptions.body = request.body;
  }

  try {
    const upstream = await fetch(targetUrl, fetchOptions);
    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}
