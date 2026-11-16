import { isMockMode } from "../config";
import { fetchUpstreamUser, UpstreamError } from "./upstream";

/** How long a confirmed-live upstream session is trusted before asking Supabase again. */
export const SESSION_CHECK_TTL_SECONDS = 60;

export type SessionVerdict = "live" | "revoked" | "unavailable";

/**
 * Revocation within about a minute (review gap 4): Supabase answers
 * /auth/v1/user with 401/403 once the session behind the upstream token is
 * gone (password change, "log out everywhere", account removal). JWT expiry
 * alone would take up to an hour.
 */
export async function checkUpstreamSession(
  env: Env,
  grantRef: string,
  userId: string,
  accessToken: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionVerdict> {
  if (isMockMode(env)) return "live";
  if (!accessToken || !env.SUPABASE_URL) return "revoked";
  const key = `sess:${grantRef}`;
  if ((await env.MCP_OPS.get(key)) === "live") return "live";
  try {
    const user = await fetchUpstreamUser(env.SUPABASE_URL.replace(/\/$/, ""), env.SUPABASE_ANON_KEY ?? "", accessToken, fetchImpl);
    if (user.id !== userId) return "revoked";
  } catch (e) {
    if (e instanceof UpstreamError && e.code === "upstream_rejected") return "revoked";
    return "unavailable";
  }
  await env.MCP_OPS.put(key, "live", { expirationTtl: SESSION_CHECK_TTL_SECONDS });
  return "live";
}
