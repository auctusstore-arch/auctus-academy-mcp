/**
 * Backend for the "Koneksi AI" page on auctus.academy (PRD §12).
 *
 * Called server-to-server by the academy app with the user's own web session
 * token. Gateway tokens (JWT claim client_id) are refused, so an AI client can
 * never list or revoke connections. The user id comes only from Supabase
 * (/auth/v1/user), never from the request.
 */
import { isMockMode } from "../config";
import { fetchUpstreamUser, UpstreamError } from "./upstream";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function jwtHasClientId(token: string): boolean {
  const part = token.split(".")[1];
  if (!part) return true; // not a JWT: treat as untrusted
  try {
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { client_id?: unknown };
    return typeof payload.client_id === "string" && payload.client_id.length > 0;
  } catch {
    return true;
  }
}

async function webUser(request: Request, env: Env): Promise<string | Response> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return json(401, { error: "unauthorized" });
  if (isMockMode(env)) return token === "mock-web-session" ? "11111111-1111-4111-8111-111111111111" : json(401, { error: "unauthorized" });
  if (jwtHasClientId(token)) return json(403, { error: "web_only" });
  if (!env.SUPABASE_URL) return json(503, { error: "upstream_unavailable" });
  try {
    const user = await fetchUpstreamUser(env.SUPABASE_URL.replace(/\/$/, ""), env.SUPABASE_ANON_KEY ?? "", token);
    return user.id;
  } catch (e) {
    if (e instanceof UpstreamError && e.code === "upstream_rejected") return json(401, { error: "unauthorized" });
    return json(503, { error: "upstream_unavailable" });
  }
}

export async function handleConnectionsApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  // Server-to-server only: browsers must not call this directly.
  if (origin) return json(403, { error: "forbidden_origin" });

  const userId = await webUser(request, env);
  if (userId instanceof Response) return userId;
  const oauth = env.OAUTH_PROVIDER;

  if (url.pathname === "/connections" && request.method === "GET") {
    const items: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await oauth.listUserGrants(userId, { limit: 100, cursor });
      for (const g of res.items) {
        const client = await oauth.lookupClient(g.clientId).catch(() => null);
        items.push({
          grant_id: g.id,
          client_id: g.clientId,
          client_name: client?.clientName ?? g.metadata?.client_name ?? null,
          client_uri: client?.clientUri ?? null,
          redirect_hosts: (client?.redirectUris ?? []).map((u: string) => {
            try {
              return new URL(u).host;
            } catch {
              return null;
            }
          }).filter(Boolean),
          scopes: g.scope,
          created_at: g.createdAt ?? null,
          expires_at: g.expiresAt ?? null,
        });
      }
      if (!res.cursor) break;
      cursor = res.cursor;
    }
    return json(200, { connections: items });
  }

  if (request.method === "DELETE") {
    if (url.pathname === "/connections") {
      let revoked = 0;
      for (let page = 0; page < 10; page++) {
        const res = await oauth.listUserGrants(userId, { limit: 100 });
        if (!res.items.length) break;
        for (const g of res.items) {
          await oauth.revokeGrant(g.id, userId);
          revoked++;
        }
      }
      return json(200, { revoked });
    }
    const match = url.pathname.match(/^\/connections\/([A-Za-z0-9_-]{1,128})$/);
    if (match?.[1]) {
      // revokeGrant is scoped by userId: another user's grant id does nothing.
      await oauth.revokeGrant(match[1], userId);
      return json(200, { revoked: 1 });
    }
  }
  return json(404, { error: "not_found" });
}
