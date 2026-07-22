import { NextRequest, NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { injectRuntimePatch, rewriteAbsolutePaths } from "@/lib/embed-rewrite";

export const dynamic = "force-dynamic";

/**
 * Reverse-Proxy für iframe-Widgets mit `proxy: true`.
 *
 *   Browser → /api/embed/<widgetId>/<path>      → upstream <widget.url-Origin>/<path>
 *
 * Strippt embedding-blockierende Response-Header (X-Frame-Options, CSP
 * frame-ancestors). Cookies werden mit entferntem Domain-Attribut weitergereicht,
 * damit sie auf der lokalen Origin (localhost:3000) wirken. HTML-Body wird so
 * umgeschrieben, dass absolute Pfade auf den Proxy zurückgeleitet werden.
 */

const STRIPPED_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  // hop-by-hop / Encoding wird von fetch bereits dekodiert
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

const STRIPPED_REQUEST_HEADERS = new Set([
  "host",
  "origin",
  "referer",
  "accept-encoding",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "x-vercel-id",
]);

interface RouteCtx {
  params: Promise<{ widgetId: string; path?: string[] }>;
}

async function handle(req: NextRequest, ctx: RouteCtx) {
  const { widgetId, path = [] } = await ctx.params;
  const config = await loadConfig();
  const widget = config.widgets.find((w) => w.id === widgetId);
  if (!widget || widget.type !== "iframe" || !widget.proxy) {
    return new NextResponse("widget nicht gefunden oder Proxy nicht aktiviert", {
      status: 404,
    });
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(widget.url);
  } catch {
    return new NextResponse("ungültige Widget-URL", { status: 500 });
  }
  // Nur http(s)-Upstreams — kein file:, ftp:, etc. Der Ziel-Host ist immer
  // der Host der (auth-geschützten) Widget-Config; Pfad/Query kommen vom
  // Client, der Origin ist damit gepinnt.
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    return new NextResponse("Widget-URL muss http(s) sein", { status: 400 });
  }

  // Ziel-URL zusammenbauen.
  // Wenn ein Sub-Path angefragt wird (z.B. /_next/static/foo.js), wird der
  // an den Origin gehängt. Ohne Sub-Path: original URL inkl. Query.
  const targetUrl = new URL(baseUrl);
  if (path.length > 0) {
    targetUrl.pathname = "/" + path.join("/");
    targetUrl.search = "";
  }
  const incoming = new URL(req.url);
  if (incoming.searchParams.size > 0) {
    targetUrl.search = "";
    for (const [k, v] of incoming.searchParams) {
      targetUrl.searchParams.set(k, v);
    }
  }

  const headers = new Headers();
  for (const [k, v] of req.headers) {
    if (STRIPPED_REQUEST_HEADERS.has(k.toLowerCase())) continue;
    headers.set(k, v);
  }
  headers.set("host", baseUrl.host);

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, init);
  } catch (err) {
    return new NextResponse(`Proxy-Fehler: ${(err as Error).message}`, {
      status: 502,
    });
  }

  // Response-Header filtern + Set-Cookie/Location umschreiben.
  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lk = key.toLowerCase();
    if (STRIPPED_RESPONSE_HEADERS.has(lk)) return;
    if (lk === "set-cookie") {
      respHeaders.append(
        "set-cookie",
        value
          .replace(/;\s*Domain=[^;]+/i, "")
          .replace(/;\s*Secure(?=;|$)/i, "")
          .replace(/;\s*SameSite=[^;]+/i, "; SameSite=Lax"),
      );
      return;
    }
    if (lk === "location") {
      try {
        const loc = new URL(value, baseUrl);
        if (loc.origin === baseUrl.origin) {
          const rebased = `/api/embed/${widgetId}${loc.pathname}${loc.search}${loc.hash}`;
          respHeaders.set("location", rebased);
          return;
        }
      } catch {
        /* malformed Location */
      }
    }
    respHeaders.append(key, value);
  });

  const contentType = upstream.headers.get("content-type") ?? "";
  const proxyPrefix = `/api/embed/${widgetId}`;

  if (contentType.includes("text/html")) {
    let html = await upstream.text();
    html = rewriteAbsolutePaths(html, baseUrl, proxyPrefix);
    html = injectRuntimePatch(html, proxyPrefix);
    return new NextResponse(html, {
      status: upstream.status,
      headers: respHeaders,
    });
  }

  if (contentType.includes("text/css")) {
    let css = await upstream.text();
    css = rewriteAbsolutePaths(css, baseUrl, proxyPrefix);
    return new NextResponse(css, {
      status: upstream.status,
      headers: respHeaders,
    });
  }

  // JS-Bundles (Next.js _next/static) enthalten oft hartcodierte API-Pfade.
  // Wir rewriten konservativ nur absolute String-Literals, die mit "/api/..."
  // o.ä. anfangen. Das deckt die meisten Next.js-Apps ab.
  if (
    contentType.includes("application/javascript") ||
    contentType.includes("text/javascript")
  ) {
    let js = await upstream.text();
    js = rewriteAbsolutePaths(js, baseUrl, proxyPrefix);
    return new NextResponse(js, {
      status: upstream.status,
      headers: respHeaders,
    });
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
export const OPTIONS = handle;
export const HEAD = handle;
