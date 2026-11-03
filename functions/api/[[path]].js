const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const requestHeadersToRemove = new Set([
  ...hopByHopHeaders,
  "content-length",
  "host",
  "forwarded",
  "x-real-ip",
]);

function headersWithoutHopByHop(source, additionalRemovals = new Set()) {
  const headers = new Headers(source);
  const connectionHeaders = headers.get("connection");

  if (connectionHeaders) {
    for (const name of connectionHeaders.split(",")) {
      headers.delete(name.trim());
    }
  }

  for (const name of [...hopByHopHeaders, ...additionalRemovals]) {
    headers.delete(name);
  }
  for (const name of [...headers.keys()]) {
    if (name.startsWith("x-forwarded-")) {
      headers.delete(name);
    }
  }

  return headers;
}

function getApiOrigin(binding) {
  if (typeof binding !== "string" || !binding) {
    throw new Error("The API_ORIGIN Pages environment binding is required.");
  }

  const origin = new URL(binding);
  if (
    origin.protocol !== "https:"
    || origin.origin !== binding
    || origin.username
    || origin.password
  ) {
    throw new Error("API_ORIGIN must be an HTTPS origin without a path or credentials.");
  }

  return origin;
}

export async function onRequest({ request, env }) {
  const apiOrigin = getApiOrigin(env.API_ORIGIN);
  const incomingUrl = new URL(request.url);
  if (incomingUrl.pathname !== "/api" && !incomingUrl.pathname.startsWith("/api/")) {
    throw new Error("The Pages API proxy only accepts /api paths.");
  }
  const upstreamUrl = new URL(apiOrigin);
  upstreamUrl.pathname = incomingUrl.pathname;
  upstreamUrl.search = incomingUrl.search;
  const headers = headersWithoutHopByHop(request.headers, requestHeadersToRemove);
  headers.set("cache-control", "no-store");
  headers.set("pragma", "no-cache");

  const response = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
    cache: "no-store",
  });

  const responseHeaders = headersWithoutHopByHop(response.headers);
  const setCookies = response.headers.getSetCookie();
  responseHeaders.delete("set-cookie");
  for (const setCookie of setCookies) {
    responseHeaders.append("set-cookie", setCookie);
  }
  responseHeaders.set("cache-control", "no-store, private, max-age=0, must-revalidate");
  responseHeaders.set("pragma", "no-cache");
  responseHeaders.set("expires", "0");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
