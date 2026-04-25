const SCRIPT_RE = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const NOSCRIPT_RE = /<noscript[\s\S]*?>[\s\S]*?<\/noscript>/gi;
const IFRAME_RE = /<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi;
const EMBED_RE = /<embed[\s\S]*?(\/>|>[\s\S]*?<\/embed>)/gi;
const OBJECT_RE = /<object[\s\S]*?>[\s\S]*?<\/object>/gi;
const ON_EVENT_RE =
  /\s+on[a-zA-Z_][\w-]*\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s>]+)/gi;
const HREF_JAVASCRIPT_RE = /(\s+href\s*=\s*["']?)javascript:[^"'>\s]*/gi;
const SRC_JAVASCRIPT_RE = /(\s+src\s*=\s*["']?)javascript:[^"'>\s]*/gi;

/**
 * Strips high-risk content before headless render; remote assets are also blocked in Playwright.
 */
export function sanitizeHtml(input: string): string {
  const SCRIPT_SELF_CLOSING = /<script[^>]*\/>/gi;

  let out = input
    .replace(SCRIPT_SELF_CLOSING, "")
    .replace(SCRIPT_RE, "")
    .replace(NOSCRIPT_RE, "")
    .replace(IFRAME_RE, "")
    .replace(OBJECT_RE, "")
    .replace(EMBED_RE, "");

  for (let i = 0; i < 3; i++) {
    out = out.replace(ON_EVENT_RE, "");
  }

  out = out
    .replace(HREF_JAVASCRIPT_RE, "$1#")
    .replace(SRC_JAVASCRIPT_RE, "$1");

  out = out.replace(
    /<link[^>]+rel\s*=\s*["']?stylesheet["']?[^>]*>/gi,
    (m) => (/\bhref\s*=\s*["']?(https?:|\/\/)/i.test(m) ? "" : m)
  );

  out = out.replace(
    /<link[^>]+rel\s*=\s*["']?(modulepreload|dns-prefetch|preconnect|prefetch|preload|prerender)[^>]*>/gi,
    ""
  );

  return out;
}
