/**
 * Rewrite-Helfer für den iframe-Reverse-Proxy (`/api/embed/...`).
 * Als eigene Lib, damit die Regex-Logik ohne HTTP-Kontext testbar ist.
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Schreibt absolute Origin-URLs und absolute Pfade (`/foo`) auf den Proxy um.
 * Berücksichtigt URL-Strings in HTML-Attributen (`href`, `src`, `srcset`,
 * `action`, `formaction`, `data`, `poster`), CSS `url(...)`/`@import` und
 * JS-String-Literale.
 */
export function rewriteAbsolutePaths(
  body: string,
  baseUrl: URL,
  proxyPrefix: string,
): string {
  // 1) Absolute URLs auf den Origin → Proxy
  const originRe = new RegExp(escapeRegex(baseUrl.origin), "g");
  body = body.replace(originRe, proxyPrefix);

  // 2) Absolute Pfade in Attributen: href="/foo" → href="/api/embed/<id>/foo"
  //    Aber NICHT, wenn schon mit dem Proxy-Prefix beginnt oder protocol-relative ist.
  const attrRe = /\b(href|src|action|formaction|data|poster)\s*=\s*(["'])\/(?!\/)((?!api\/embed\/)[^"']*)\2/gi;
  body = body.replace(attrRe, (_m, attr, q, rest) => `${attr}=${q}${proxyPrefix}/${rest}${q}`);

  // 3) srcset: Komma-separierte Einträge mit absoluten Pfaden
  const srcsetRe = /\b(srcset|imagesrcset)\s*=\s*(["'])([^"']+)\2/gi;
  body = body.replace(srcsetRe, (_m, attr, q, list: string) => {
    const rewritten = list
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.startsWith(`${proxyPrefix}/`)) {
          return `${proxyPrefix}${trimmed}`;
        }
        return trimmed;
      })
      .join(", ");
    return `${attr}=${q}${rewritten}${q}`;
  });

  // 4) CSS url(...) und @import
  const cssUrlRe = /\burl\(\s*(["']?)\/(?!\/)((?!api\/embed\/)[^)"']*)\1\s*\)/g;
  body = body.replace(cssUrlRe, (_m, q, rest) => `url(${q}${proxyPrefix}/${rest}${q})`);

  return body;
}

/**
 * Injectet ein <script> ganz am Anfang von <head> das `fetch` und
 * `XMLHttpRequest` so umlenkt, dass absolute Pfade durch den Proxy
 * laufen. Dadurch funktionieren auch SPA-API-Calls, die zur Laufzeit
 * dynamisch generiert werden.
 */
export function injectRuntimePatch(html: string, proxyPrefix: string): string {
  const baseTag = /<head[^>]*>/i.test(html) && !/<base\s/i.test(html)
    ? `<base href="${proxyPrefix}/">`
    : "";

  const patch = `<script>
(function(){
  var P=${JSON.stringify(proxyPrefix)};
  function fix(u){
    if(typeof u!=='string')return u;
    if(u.indexOf('/')!==0)return u;
    if(u.indexOf('//')===0)return u;
    if(u.indexOf(P+'/')===0)return u;
    return P+u;
  }
  var of=window.fetch;
  if(of){
    window.fetch=function(input,init){
      if(typeof input==='string')input=fix(input);
      else if(input&&input.url){try{var n=fix(input.url);if(n!==input.url)input=new Request(n,input);}catch(e){}}
      return of.call(this,input,init);
    };
  }
  var xo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    arguments[1]=fix(u);
    return xo.apply(this,arguments);
  };
})();
</script>`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}${patch}`);
  }
  return patch + html;
}
