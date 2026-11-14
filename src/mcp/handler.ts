import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { MAX_REQUEST_BYTES } from "../config";
import { evaluateAccess, loadKillSwitch } from "../security/kill-switch";
import { checkReadRateLimit } from "../security/rate-limit";
import { hashToolArgs, AuditLogSink } from "../audit/logger";
import type { ToolContext } from "../data/port";
import { createMcpServer } from "./register-tools";

type AuthProps = {
  userId: string;
  upstreamAccessToken?: string;
};

const auditByUser = new Map<string, AuditLogSink>();

function auditFor(userId: string): AuditLogSink {
  let sink = auditByUser.get(userId);
  if (!sink) {
    sink = new AuditLogSink();
    auditByUser.set(userId, sink);
  }
  return sink;
}

export async function handleMcpRequest(
  request: Request,
  env: Env,
  ctx: OAuthResourceContext<AuthProps>,
): Promise<Response> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_REQUEST_BYTES) {
    return new Response("payload_too_large", { status: 413 });
  }

  const kill = await loadKillSwitch(env.MCP_OPS);
  const clientId = ctx.auth.clientId ?? "unknown";
  const gate = evaluateAccess(kill, clientId);
  if (!gate.allowed) {
    return new Response(JSON.stringify({ error: gate.reason }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  const userId = ctx.props.userId ?? ctx.auth.userId ?? "";
  if (!userId) return new Response("unauthorized", { status: 401 });

  const rl = await checkReadRateLimit(env.MCP_OPS, userId, clientId);
  if (!rl.allowed) {
    return new Response("rate_limited", { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } });
  }

  const getContext = (): ToolContext => ({
    userId,
    scopes: ctx.auth.scope ?? [],
    clientId,
    env,
    upstreamAccessToken: ctx.props.upstreamAccessToken,
  });

  const mcpServer = createMcpServer(getContext);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcpServer.connect(transport);

  const toolName = request.headers.get("Mcp-Name") ?? request.headers.get("mcp-name") ?? "unknown";

  const response = await transport.handleRequest(request);

  const argsHash = await hashToolArgs({ tool: toolName, mcp_method: request.headers.get("Mcp-Method") });
  await auditFor(userId).append({
    userId,
    clientId,
    grantId: ctx.auth.token,
    tool: toolName,
    scope: (ctx.auth.scope ?? []).join(" "),
    argsHash,
    status: response.ok ? "ok" : "error",
    userAgent: request.headers.get("User-Agent") ?? undefined,
  });

  return response;
}