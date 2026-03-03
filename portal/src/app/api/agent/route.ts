import { NextRequest } from "next/server";

const AGENT_BASE_URL = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8501";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

async function proxyRoot(request: NextRequest) {
  try {
    const upstreamUrl = new URL(AGENT_BASE_URL);
    upstreamUrl.search = request.nextUrl.search;

    const requestHeaders = new Headers();
    request.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        requestHeaders.set(key, value);
      }
    });

    requestHeaders.set("x-forwarded-host", request.headers.get("host") ?? "");
    requestHeaders.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));
    requestHeaders.set("x-forwarded-for", request.headers.get("x-forwarded-for") ?? "127.0.0.1");

    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: requestHeaders,
      redirect: "manual",
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    });

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete("content-length");
    responseHeaders.delete("x-frame-options");
    responseHeaders.delete("content-security-policy");

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Proxy request failed",
      },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  return proxyRoot(request);
}

export async function POST(request: NextRequest) {
  return proxyRoot(request);
}

export async function PUT(request: NextRequest) {
  return proxyRoot(request);
}

export async function PATCH(request: NextRequest) {
  return proxyRoot(request);
}

export async function DELETE(request: NextRequest) {
  return proxyRoot(request);
}

export async function HEAD(request: NextRequest) {
  return proxyRoot(request);
}
