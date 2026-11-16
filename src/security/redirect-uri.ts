import { DCR_REDIRECT_HOST_ALLOWLIST } from "../config";

export type RedirectUriCheck =
  | { ok: true; host: string; isLoopback: boolean }
  | { ok: false; reason: string };

/** Exact redirect URI match (scheme, host, port, path, query). */
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
  if (parsed.protocol === "http:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    return { ok: false, reason: "http_only_loopback" };
  }
  const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (!DCR_REDIRECT_HOST_ALLOWLIST.has(parsed.hostname)) {
    return { ok: false, reason: "host_not_allowlisted" };
  }
  const exact = registered.some((r) => r === redirectUri);
  if (!exact) return { ok: false, reason: "redirect_uri_mismatch" };
  return { ok: true, host: parsed.hostname, isLoopback };
}

export function hostOfRedirectUri(redirectUri: string): string | null {
  try {
    return new URL(redirectUri).hostname;
  } catch {
    return null;
  }
}