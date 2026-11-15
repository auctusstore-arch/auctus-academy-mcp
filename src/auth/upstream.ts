/**
 * Supabase OAuth 2.1 Server as upstream identity (PRD §5 Opsi B).
 *
 * The Worker is a confidential client (`auctus-mcp-gateway`). The Supabase
 * tokens it receives never leave the Worker: they live only in the grant's
 * encrypted props. AI clients only ever hold opaque MCP tokens.
 *
 * Endpoints: https://supabase.com/docs/guides/auth/oauth-server/oauth-flows
 */

export type UpstreamTokens = {
  access_token: string;
  refresh_token: string;
  /** Epoch seconds. */
  expires_at: number;
};

export type UpstreamConfig = {
  supabaseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/** Refresh the upstream token this many seconds before it expires. */
export const UPSTREAM_REFRESH_SKEW_SECONDS = 120;
const UPSTREAM_TIMEOUT_MS = 10_000;

export class UpstreamError extends Error {
  constructor(
    readonly code: "upstream_not_configured" | "upstream_rejected" | "upstream_unavailable" | "upstream_invalid_response",
  ) {
    super(code);
    this.name = "UpstreamError";
  }
}

export function upstreamConfigFromEnv(env: Env): UpstreamConfig {
  const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, "");
  const clientId = env.SUPABASE_OAUTH_CLIENT_ID;
  const clientSecret = env.SUPABASE_OAUTH_CLIENT_SECRET;
  const redirectUri = env.SUPABASE_OAUTH_REDIRECT_URI;
  if (!supabaseUrl || !clientId || !clientSecret || !redirectUri) throw new UpstreamError("upstream_not_configured");
  if (!/^https:\/\//.test(supabaseUrl)) throw new UpstreamError("upstream_not_configured");
  return { supabaseUrl, clientId, clientSecret, redirectUri };
}

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge: base64Url(digest) };
}

export function buildUpstreamAuthorizeUrl(cfg: UpstreamConfig, state: string, challenge: string): string {
  const url = new URL(`${cfg.supabaseUrl}/auth/v1/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", "openid email");
  return url.toString();
}

async function postToken(cfg: UpstreamConfig, body: URLSearchParams, fetchImpl: typeof fetch): Promise<UpstreamTokens> {
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`,
      },
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError("upstream_unavailable");
  }
  if (res.status === 400 || res.status === 401) throw new UpstreamError("upstream_rejected");
  if (!res.ok) throw new UpstreamError("upstream_unavailable");
  const json = (await res.json().catch(() => null)) as
    | { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
    | null;
  if (!json || typeof json.access_token !== "string" || typeof json.refresh_token !== "string") {
    throw new UpstreamError("upstream_invalid_response");
  }
  const expiresIn = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 3600;
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
  };
}

export function exchangeUpstreamCode(
  cfg: UpstreamConfig,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpstreamTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: verifier,
  });
  return postToken(cfg, body, fetchImpl);
}

/**
 * Refreshing upstream is how a password change or "log out everywhere" reaches
 * MCP: Supabase revokes the refresh token, this call fails with
 * upstream_rejected, and the caller revokes the MCP grant.
 */
export function refreshUpstream(
  cfg: UpstreamConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpstreamTokens> {
  return postToken(cfg, new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }), fetchImpl);
}

/** Verifies the upstream access token with Supabase Auth and returns the user id. */
export async function fetchUpstreamUser(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; email: string | null }> {
  let res: Response;
  try {
    res = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError("upstream_unavailable");
  }
  if (res.status === 401 || res.status === 403) throw new UpstreamError("upstream_rejected");
  if (!res.ok) throw new UpstreamError("upstream_unavailable");
  const json = (await res.json().catch(() => null)) as { id?: unknown; email?: unknown } | null;
  if (!json || typeof json.id !== "string" || !/^[0-9a-f-]{36}$/i.test(json.id)) {
    throw new UpstreamError("upstream_invalid_response");
  }
  return { id: json.id, email: typeof json.email === "string" ? json.email : null };
}

export function upstreamNeedsRefresh(tokens: UpstreamTokens, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return tokens.expires_at - nowSeconds <= UPSTREAM_REFRESH_SKEW_SECONDS;
}
