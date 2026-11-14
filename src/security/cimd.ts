const CIMD_MAX_BYTES = 64 * 1024;
const CIMD_TIMEOUT_MS = 10_000;

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
];

export async function fetchClientMetadataDocument(clientIdUrl: string): Promise<{ ok: true; metadata: Record<string, unknown> } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(clientIdUrl);
  } catch {
    return { ok: false, reason: "invalid_client_id_url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "cimd_https_only" };
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(url.hostname))) {
    return { ok: false, reason: "cimd_private_host" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CIMD_TIMEOUT_MS);
  try {
    const response = await fetch(clientIdUrl, {
      signal: controller.signal,
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (location) {
        try {
          const loc = new URL(location, clientIdUrl);
          if (PRIVATE_HOST_PATTERNS.some((re) => re.test(loc.hostname))) {
            return { ok: false, reason: "cimd_redirect_private" };
          }
        } catch {
          return { ok: false, reason: "cimd_redirect_invalid" };
        }
      }
      return { ok: false, reason: "cimd_redirect_not_followed" };
    }
    if (!response.ok) return { ok: false, reason: "cimd_fetch_failed" };
    const buf = await response.arrayBuffer();
    if (buf.byteLength > CIMD_MAX_BYTES) return { ok: false, reason: "cimd_too_large" };
    const metadata = JSON.parse(new TextDecoder().decode(buf)) as Record<string, unknown>;
    return { ok: true, metadata };
  } catch {
    return { ok: false, reason: "cimd_fetch_error" };
  } finally {
    clearTimeout(timer);
  }
}