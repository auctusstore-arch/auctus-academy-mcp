import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { isMockMode, MAX_REQUEST_BYTES } from "../config";
import type { AuthProps } from "../auth/props";
import { checkUpstreamSession } from "../auth/session-check";
import { createMockRpc, sharedMockDb } from "../data/mock-rpc";
import type { ToolContext } from "../data/port";
import { createRpcCaller, type RpcCaller } from "../data/supabase";
import { createHash } from "../lib/hash";
import { evaluateAccess, loadKillSwitch } from "../security/kill-switch";
import { checkReadRateLimit } from "../security/rate-limit";
import { createMcpServer } from "./register-tools";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/**
 * MCP 2026-07-28 requires Mcp-Method / Mcp-Name so WAF rate limits can work
 * per tool. A client could send cheap headers and an expensive body, so a
 * mismatch is refused (review: header-based limits must not be dodgeable).
 */
export function checkMcpHeaders(headers: Headers, body: unknown): string | null {
  if (Array.isArray(body)) return "batch_not_supported";
  if (!body || typeof body !== "object") return null;
  const msg = body as { method?: unknown; params?: { name?: unknown; uri?: unknown } };
  const method = headers.get("Mcp-Method");
  if (method && typeof msg.method === "string" && method !== msg.method) return "mcp_method_mismatch";
  const name = headers.get("Mcp-Name");
  if (name) {
    const actual = msg.method === "tools/call" || msg.method === "prompts/get" ? msg.params?.name : msg.method === "resources/read" ? msg.params?.uri : undefined;
    if (typeof actual === "string" && actual !== name) return "mcp_name_mismatch";
  }
  return null;
}

export async function handleMcpRequest(request: Request, env: Env, ctx: OAuthResourceContext<AuthProps>): Promise<Response> {
  if (Number(request.headers.get("Content-Length") ?? "0") > MAX_REQUEST_BYTES) return json(413, { error: "payload_too_large" });

  const kill = await loadKillSwitch(env.MCP_OPS);
  const clientId = ctx.auth.clientId ?? "unknown";
  const gate = evaluateAccess(kill, clientId);
  if (!gate.allowed) return json(503, { error: gate.reason });

  const userId = ctx.props?.userId ?? ctx.auth.userId ?? "";
  if (!userId) return json(401, { error: "unauthorized" });

  const rl = await checkReadRateLimit(env.MCP_OPS, userId, clientId);
  if (!rl.allowed) return json(429, { error: "rate_limited" }, { "Retry-After": String(rl.retryAfterSec ?? 60) });

  // Read the body once with a hard size cap (Content-Length can be absent or wrong).
  let raw = "";
  if (request.method === "POST") {
    raw = await request.text();
    if (raw.length > MAX_REQUEST_BYTES) return json(413, { error: "payload_too_large" });
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      return json(400, { error: "invalid_json" });
    }
    const mismatch = checkMcpHeaders(request.headers, parsed);
    if (mismatch) return json(400, { error: mismatch });
  }

  const summary = await env.OAUTH_PROVIDER.unwrapToken<AuthProps>(ctx.auth.token).catch(() => null);
  const grantRef = summary?.grantId ? (await createHash(`grant:${summary.grantId}`)).slice(0, 32) : "unknown";
  const upstreamToken = ctx.props?.upstream?.access_token;

  const session = await checkUpstreamSession(env, grantRef, userId, upstreamToken);
  if (session === "revoked") {
    if (summary?.grantId) await env.OAUTH_PROVIDER.revokeGrant(summary.grantId, userId).catch(() => undefined);
    return json(401, { error: "session_revoked" }, { "WWW-Authenticate": 'Bearer error="invalid_token"' });
  }
  if (session === "unavailable") return json(503, { error: "upstream_unavailable" }, { "Retry-After": "30" });

  let rpc: RpcCaller;
  if (isMockMode(env)) {
    rpc = createMockRpc(sharedMockDb(), userId);
  } else {
    if (!env.SUPABASE_URL || !upstreamToken) return json(401, { error: "unauthorized" });
    rpc = createRpcCaller({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY ?? "", accessToken: upstreamToken });
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(clientId).catch(() => null);
  const userAgent = request.headers.get("User-Agent")?.slice(0, 300) ?? undefined;
  const country = (request as Request & { cf?: { country?: string } }).cf?.country;
  const scopeStr = (ctx.auth.scope ?? []).join(" ");

  const toolContext: ToolContext = {
    userId,
    scopes: ctx.auth.scope ?? [],
    clientId,
    env,
    rpc,
    client: { id: clientId, name: client?.clientName ?? undefined, grant: grantRef, ua: userAgent, country },
    upstreamAccessToken: upstreamToken,
    auditTool: async (partial) => {
      await rpc("log_event", {
        p_client_id: clientId,
        p_client_name: client?.clientName ?? null,
        p_grant_ref: grantRef,
        p_tool: partial.tool,
        p_scope: scopeStr,
        p_args_hash: partial.argsHash,
        p_status: partial.status,
        p_record_count: partial.recordCount ?? null,
        p_user_agent: userAgent ?? null,
        p_ip_country: country ?? null,
      });
    },
  };

  const mcpServer = createMcpServer(() => toolContext);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await mcpServer.connect(transport);
  const replay = new Request(request.url, { method: request.method, headers: request.headers, body: request.method === "POST" ? raw : undefined });
  return transport.handleRequest(replay);
}
