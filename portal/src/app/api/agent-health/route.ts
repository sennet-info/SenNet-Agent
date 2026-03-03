const AGENT_BASE_URL = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8501";

export async function GET() {
  try {
    const upstreamUrl = new URL(AGENT_BASE_URL);
    upstreamUrl.pathname = upstreamUrl.pathname || "/";

    const response = await fetch(upstreamUrl, {
      method: "GET",
      cache: "no-store",
    });

    return Response.json({ ok: response.ok, status: response.status });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 },
    );
  }
}
