import OAuthProvider, { type OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  DCR_CLIENT_TTL_SECONDS,
  DCR_REDIRECT_HOST_ALLOWLIST,
  MCP_SCOPES,
  REFRESH_TOKEN_IDLE_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./config";
import { defaultHandler } from "./auth/default-handler";
import { handleMcpRequest } from "./mcp/handler";
import { hostOfRedirectUri } from "./security/redirect-uri";

type AuthProps = { userId: string; upstreamAccessToken?: string };

const mcpApiHandler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    return handleMcpRequest(request, env, ctx as OAuthResourceContext<AuthProps>);
  },
};

function buildProvider(env: Env) {
  const issuer = env.ISSUER_URL.replace(/\/$/, "");
  const resource = env.RESOURCE_URL;
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: mcpApiHandler as NonNullable<import("@cloudflare/workers-oauth-provider").OAuthProviderOptions<Env>["apiHandler"]>,
    defaultHandler: {
      fetch: (req, environment) => defaultHandler(req, environment),
    },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTTL: REFRESH_TOKEN_TTL_SECONDS,
    refreshTokenIdleTTL: REFRESH_TOKEN_IDLE_SECONDS,
    clientRegistrationTTL: DCR_CLIENT_TTL_SECONDS,
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [MCP_SCOPES.SR_READ, MCP_SCOPES.OFFLINE],
    requiredScopes: [MCP_SCOPES.SR_READ],
    resourceMetadata: {
      resource,
      authorization_servers: [issuer],
    },
    clientRegistrationCallback(options) {
      const redirects = Array.isArray(options.clientMetadata.redirect_uris)
        ? (options.clientMetadata.redirect_uris as string[])
        : [];
      for (const uri of redirects) {
        const host = hostOfRedirectUri(uri);
        if (!host || !DCR_REDIRECT_HOST_ALLOWLIST.has(host)) {
          throw new Error("redirect_uri_not_allowed");
        }
      }
    },
  });
}

let cachedProvider: OAuthProvider<Env> | null = null;
let cachedProviderKey = "";

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const key = `${env.ISSUER_URL}|${env.RESOURCE_URL}`;
    if (!cachedProvider || cachedProviderKey !== key) {
      cachedProvider = buildProvider(env);
      cachedProviderKey = key;
    }
    return cachedProvider.fetch(request, env, ctx);
  },
};

export { buildProvider };