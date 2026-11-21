import OAuthProvider, { getOAuthApi, OAuthError, type OAuthProviderOptions, type OAuthResourceContext, type TokenExchangeCallbackOptions } from "@cloudflare/workers-oauth-provider";
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
import { loadKillSwitch } from "./security/kill-switch";
import { checkDcrRateLimit } from "./security/rate-limit";
import { hostOfRedirectUri } from "./security/redirect-uri";
import { withAuthCodeGuard } from "./security/token-guard";

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

function providerOptions(env: Env): OAuthProviderOptions<Env> {
  const issuer = env.ISSUER_URL.replace(/\/$/, "");
  return {
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
  };
}

function buildProvider(env: Env) {
  return new OAuthProvider<Env>(providerOptions(env));
}

let cachedProvider: OAuthProvider<Env> | null = null;
let cachedProviderKey = "";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    // Kill switch also stops new logins and token refresh, not only /mcp (pentest F8c).
    if (path === "/authorize" || path === "/token" || path === "/register") {
      const kill = await loadKillSwitch(env.MCP_OPS).catch(() => null);
      if (kill?.globalDisabled) {
        return new Response(JSON.stringify({ error: "temporarily_unavailable" }), { status: 503, headers: { "Content-Type": "application/json", "Retry-After": "300" } });
      }
    }
    // DCR is limited per IP and redirect host class (PRD §9); the registration callback has no env access.
    if (request.method === "POST" && path === "/register") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const rl = await checkDcrRateLimit(env, ip, await redirectClassOf(request));
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
    const provider = cachedProvider;
    // Authorization codes must be single-use even under concurrent exchanges (pentest W-Replay).
    if (request.method === "POST" && path === "/token") {
      return withAuthCodeGuard(
        request,
        {
          guard: env.AUTH_CODE_GUARD,
          mockMode: isMockMode(env),
          revokeGrant: (grantId, userId) => getOAuthApi(providerOptions(env), env).revokeGrant(grantId, userId),
        },
        () => provider.fetch(request, env, ctx),
      );
    }
    return provider.fetch(request, env, ctx);
  },
};

export { AuthCodeGuard } from "./security/auth-code-guard";
export { buildProvider };

/** "platform" only when every redirect URI is on an allowlisted https platform host. */
async function redirectClassOf(request: Request): Promise<"platform" | "other"> {
  try {
    const body = (await request.clone().json()) as { redirect_uris?: unknown };
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (!uris.length) return "other";
    return uris.every((u) => {
      const url = new URL(u);
      return url.protocol === "https:" && DCR_REDIRECT_HOST_ALLOWLIST.has(url.hostname) && url.hostname !== "localhost";
    })
      ? "platform"
      : "other";
  } catch {
    return "other";
  }
}
