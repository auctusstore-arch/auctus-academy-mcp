import { authorizationErrorRedirect, AuthorizationError, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { isMockMode, MCP_SCOPE_LIST } from "../config";
import { createRpcCaller } from "../data/supabase";
import type { WhoamiRow } from "../data/port";
import { resolveEntitlementFromWhoami } from "../entitlement";
import { catalogWellKnownJson } from "../mcp/catalog";
import { handleConnectionsApi } from "./connections-api";
import { renderConsentPage, renderPlanDeniedPage, renderErrorPage } from "./consent-page";
import {
  buildUpstreamAuthorizeUrl,
  createPkcePair,
  exchangeUpstreamCode,
  fetchUpstreamUser,
  upstreamConfigFromEnv,
  UpstreamError,
} from "./upstream";
import type { AuthProps } from "./props";

const MOCK_USER_ID = "11111111-1111-4111-8111-111111111111";

export async function defaultHandler(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/.well-known/auctus-mcp-tools.json") {
    const body = await catalogWellKnownJson();
    return Response.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
  }
  if (url.pathname === "/health") return new Response("ok");
  if (url.pathname === "/authorize") return handleAuthorize(request, env);
  if (url.pathname === "/consent/upstream-callback") return handleUpstreamCallback(request, env);
  if (url.pathname.startsWith("/connections")) return handleConnectionsApi(request, env);
  return new Response("not_found", { status: 404 });
}

function htmlHeaders(base?: Headers): Headers {
  const headers = new Headers(base);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return headers;
}

async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauth: OAuthHelpers = env.OAUTH_PROVIDER;
  try {
    if (request.method === "GET") {
      const parsed = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(parsed);
      const consent = await oauth.beginConsent(parsed);
      return new Response(renderConsentPage(details, consent.handle), { headers: htmlHeaders(consent.headers) });
    }
    if (request.method === "POST") {
      const form = await request.formData();
      const handle = String(form.get("handle") ?? "");
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle, { scope: approvedScopes(form) });
      if (isMockMode(env)) {
        const completed = await oauth.completeAuthorization({
          request: approved.request,
          userId: MOCK_USER_ID,
          metadata: { mock: true },
          scope: approved.request.scope,
          props: { userId: MOCK_USER_ID } satisfies AuthProps,
        });
        approved.headers.set("Location", completed.redirectTo);
        return new Response(null, { status: 302, headers: approved.headers });
      }
      // Login happens at Supabase (Auctus account, MFA when enabled). The PKCE
      // verifier stays server-side, bound to this browser by the library cookie.
      const cfg = upstreamConfigFromEnv(env);
      const pkce = await createPkcePair();
      const upstream = await oauth.beginUpstream(approved.request, {
        data: { verifier: pkce.verifier },
        headers: approved.headers,
      });
      upstream.headers.set("Location", buildUpstreamAuthorizeUrl(cfg, upstream.state, pkce.challenge));
      upstream.headers.set("Cache-Control", "no-store");
      return new Response(null, { status: 302, headers: upstream.headers });
    }
    return new Response("method_not_allowed", { status: 405 });
  } catch (e) {
    return authorizeFailure(e);
  }
}

/** Only scopes the user ticked, and only ones the server supports. */
export function approvedScopes(form: FormData): string[] {
  const supported = new Set<string>(MCP_SCOPE_LIST);
  const values = [...new Set(form.getAll("scope").map(String))].filter((s) => supported.has(s));
  return values.length ? values : ["sr.read"];
}

async function handleUpstreamCallback(request: Request, env: Env): Promise<Response> {
  if (isMockMode(env)) return new Response("not_found", { status: 404 });
  const oauth: OAuthHelpers = env.OAUTH_PROVIDER;
  try {
    const resumed = await oauth.finishUpstream<{ verifier: string }>(request);
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.get("error")) {
      return redirectWithHeaders(authorizationErrorRedirect(resumed.request, "access_denied"), resumed.headers);
    }
    const cfg = upstreamConfigFromEnv(env);
    const anonKey = env.SUPABASE_ANON_KEY ?? "";
    const tokens = await exchangeUpstreamCode(cfg, code, resumed.data.verifier);
    const user = await fetchUpstreamUser(cfg.supabaseUrl, anonKey, tokens.access_token);

    // Entitlement before any grant exists: Free gets no MCP (decision 13 Nov 2026).
    const rpc = createRpcCaller({ supabaseUrl: cfg.supabaseUrl, anonKey, accessToken: tokens.access_token });
    const who = await rpc<WhoamiRow>("whoami");
    const ent = resolveEntitlementFromWhoami(who);
    if (!ent.allowed) {
      const back = authorizationErrorRedirect(resumed.request, "access_denied", "plan_denied");
      return new Response(renderPlanDeniedPage(back, env.WEB_APP_ORIGIN), { status: 403, headers: htmlHeaders(resumed.headers) });
    }

    const client = await oauth.lookupClient(resumed.request.clientId);
    const completed = await oauth.completeAuthorization({
      request: resumed.request,
      userId: user.id,
      metadata: { client_name: client?.clientName ?? null, approved_at: new Date().toISOString() },
      scope: resumed.request.scope,
      props: { userId: user.id, upstream: tokens } satisfies AuthProps,
      revokeExistingGrants: true,
    });
    return redirectWithHeaders(completed.redirectTo, resumed.headers);
  } catch (e) {
    return authorizeFailure(e);
  }
}

function redirectWithHeaders(location: string, base: Headers): Response {
  const headers = new Headers(base);
  headers.set("Location", location);
  headers.set("Cache-Control", "no-store");
  return new Response(null, { status: 302, headers });
}

function authorizeFailure(e: unknown): Response {
  // Never echo upstream or library internals to the browser.
  if (e instanceof AuthorizationError) {
    return new Response(renderErrorPage("Permintaan izin kedaluwarsa atau tidak valid. Mulai lagi dari aplikasi AI Anda."), {
      status: 400,
      headers: htmlHeaders(),
    });
  }
  if (e instanceof UpstreamError && e.code === "upstream_rejected") {
    return new Response(renderErrorPage("Login ke akun Auctus gagal atau dibatalkan. Mulai lagi dari aplikasi AI Anda."), {
      status: 400,
      headers: htmlHeaders(),
    });
  }
  return new Response(renderErrorPage("Layanan login sedang bermasalah. Coba lagi beberapa saat lagi."), {
    status: 503,
    headers: htmlHeaders(),
  });
}
