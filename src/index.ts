import OAuthProvider, { OAuthError, type OAuthResourceContext, type TokenExchangeCallbackOptions } from "@cloudflare/workers-oauth-provider";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  DCR_CLIENT_TTL_SECONDS,
  DCR_REDIRECT_HOST_ALLOWLIST,
  isMockMode,
  MCP_SCOPE_LIST,
  MCP_SCOPES,
  REFRESH_TOKEN_IDLE_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./config";
import { defaultHandler } from "./auth/default-handler";
import type { AuthProps } from "./auth/props";
import { refreshUpstream, upstreamConfigFromEnv, UpstreamError } from "./auth/upstream";
import { handleMcpRequest } from "./mcp/handler";
import { checkDcrRateLimit } from "./security/rate-limit";
import { hostOfRedirectUri } from "./security/redirect-uri";

const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: OAuthResourceContext<AuthProps>) {
    return handleMcpRequest(request, env, ctx);
  },
};

/**
 * On every MCP refresh: keep the upstream Supabase token valid for at least one
 * MCP access-token lifetime. If Supabase refuses the refresh (password change,
 * global logout, deleted user), `invalid_grant` makes the library revoke the
 * whole MCP grant.
 */
export async function tokenExchangeCallback(options: TokenExchangeCallbackOptions<Env>) {
  if (options.grantType !== "refresh_token" || isMockMode(options.env)) return;
  const props = options.props as AuthProps;
  if (!props?.upstream) {
    throw new OAuthError("invalid_grant", { description: "upstream session missing" });
  }
  const now = Math.floor(Date.now() / 1000);
  if (props.upstream.expires_at - now > ACCESS_TOKEN_TTL_SECONDS + 120) return;
  try {
    const upstream = await refreshUpstream(upstreamConfigFromEnv(options.env), props.upstream.refresh_token);
    return { newProps: { ...props, upstream } satisfies AuthProps };
  } catch (e) {
    if (e instanceof UpstreamError && e.code === "upstream_rejected") {
      throw new OAuthError("invalid_grant", { description: "upstream session ended" });
    }
    throw new OAuthError("temporarily_unavailable", { description: "upstream unavailable", statusCode: 503, headers: { "Retry-After": "30" } });
  }
}

function buildProvider(env: Env) {
  const issuer = env.ISSUER_URL.replace(/\/$/, "");
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: mcpApiHandler as never,
    defaultHandler: { fetch: (req, environment) => defaultHandler(req, environment) },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTTL: REFRESH_TOKEN_TTL_SECONDS,
    refreshTokenIdleTTL: REFRESH_TOKEN_IDLE_SECONDS,
    clientRegistrationTTL: DCR_CLIENT_TTL_SECONDS,
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [...MCP_SCOPE_LIST],
    requiredScopes: [MCP_SCOPES.SR_READ],
    resourceMetadata: { resource: env.RESOURCE_URL, authorization_servers: [issuer] },
    tokenExchangeCallback,
    clientRegistrationCallback(options) {
      const redirects = Array.isArray(options.clientMetadata.redirect_uris) ? (options.clientMetadata.redirect_uris as string[]) : [];
      for (const uri of redirects) {
        const host = hostOfRedirectUri(uri);
        if (!host || !DCR_REDIRECT_HOST_ALLOWLIST.has(host)) {
          return { code: "invalid_redirect_uri", description: "redirect host is not on the Auctus allowlist" };
        }
      }
      return undefined;
    },
  });
}

let cachedProvider: OAuthProvider<Env> | null = null;
let cachedProviderKey = "";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // DCR is limited per IP (PRD §9); the library's registration callback has no env access.
    if (request.method === "POST" && new URL(request.url).pathname === "/register") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const rl = await checkDcrRateLimit(env.MCP_OPS, ip);
      if (!rl.allowed) {
        return new Response(JSON.stringify({ error: "slow_down", error_description: "too many registrations" }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec ?? 3600) },
        });
      }
    }
    const key = `${env.ISSUER_URL}|${env.RESOURCE_URL}`;
    if (!cachedProvider || cachedProviderKey !== key) {
      cachedProvider = buildProvider(env);
      cachedProviderKey = key;
    }
    return cachedProvider.fetch(request, env, ctx);
  },
};

export { buildProvider };
