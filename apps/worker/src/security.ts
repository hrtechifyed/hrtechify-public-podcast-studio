import type { WorkerEnv } from "./db";

const MAX_JSON_BODY_BYTES = 64 * 1024;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const expectedOrigins = (request: Request, env: WorkerEnv) => {
  const origins = new Set<string>([new URL(request.url).origin]);
  if (env.APP_URL) {
    try {
      origins.add(new URL(env.APP_URL).origin);
    } catch {
      // Invalid APP_URL is handled by the feature that requires it; do not broaden allowed origins here.
    }
  }
  return origins;
};

export const enforceRequestSecurity = (
  request: Request,
  env: WorkerEnv,
): Response | null => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/") || !MUTATION_METHODS.has(request.method.toUpperCase())) {
    return null;
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    return new Response(JSON.stringify({ error: "cross_site_request_rejected" }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const origin = request.headers.get("origin");
  if (origin && !expectedOrigins(request, env).has(origin)) {
    return new Response(JSON.stringify({ error: "origin_not_allowed" }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.startsWith("application/json")) {
    const contentLength = request.headers.get("content-length");
    if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_JSON_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "json_body_too_large" }), {
        status: 413,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
  }

  return null;
};

export const applySecurityHeaders = (response: Response, request: Request) => {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=(self)");
  headers.set(
    "content-security-policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://hrtechify.com data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; worker-src 'self' blob:",
  );
  headers.set("cache-control", headers.get("cache-control") || "no-store");
  if (new URL(request.url).protocol === "https:") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const securityConfiguration = {
  maxJsonBodyBytes: MAX_JSON_BODY_BYTES,
  sameOriginMutations: true,
  frameEmbeddingAllowed: false,
  microphonePermission: "self-only",
} as const;
