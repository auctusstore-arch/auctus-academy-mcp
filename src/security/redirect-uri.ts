import { PINNED_REDIRECT_URIS } from "../config";

export type RedirectUriCheck =
  | { ok: true; host: string; isLoopback: boolean }
  | { ok: false; reason: string };

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * The one redirect policy, used for EVERY client (dynamic registration, Client ID
 * Metadata Document clients, authorize, approve and the upstream callback; pentest
 * F1 and F6):
 *  - https: only an EXACT pinned URI (scheme, host, port, path, no query), never a
 *    whole host, because an open redirect anywhere on an allowlisted host would hand
 *    out authorization codes;
 *  - http: loopback only (RFC 8252, any port and path), never a remote host;
 *  - nothing else (custom schemes, userinfo, fragments).
 */
export function isRedirectAllowed(redirectUri: string | undefined | null): boolean {
  if (!redirectUri) return false;
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }
  if (parsed.hash || parsed.username || parsed.password) return false;
  if (parsed.protocol === "http:") return isLoopbackHost(parsed.hostname);
  if (parsed.protocol === "https:") return PINNED_REDIRECT_URIS.has(redirectUri);
  return false;
}

/** Exact redirect URI match against the registered ones, and the shared policy above. */
export function parseAndValidateRedirectUri(redirectUri: string, registered: string[]): RedirectUriCheck {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return { ok: false, reason: "invalid_uri" };
  }
  if (parsed.hash) return { ok: false, reason: "fragment_not_allowed" };
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "scheme_not_allowed" };
  }
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
    return { ok: false, reason: "http_only_loopback" };
  }
  if (!isRedirectAllowed(redirectUri)) return { ok: false, reason: "redirect_not_pinned" };
  if (!registered.some((r) => r === redirectUri)) return { ok: false, reason: "redirect_uri_mismatch" };
  return { ok: true, host: parsed.hostname, isLoopback: isLoopbackHost(parsed.hostname) };
}
