import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { isMockMode } from "../config";
import { resolveEntitlement } from "../entitlement";
import { catalogWellKnownJson } from "../mcp/catalog";
import { renderConsentPage } from "./consent-page";

export async function defaultHandler(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/.well-known/auctus-mcp-tools.json") {
    const body = await catalogWellKnownJson();
    return Response.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
  }
  if (url.pathname === "/health") return new Response("ok");
  if (url.pathname === "/consent/upstream-callback") {
    return handleUpstreamCallback(request, env);
  }
  if (url.pathname === "/authorize") {
    return handleAuthorize(request, env);
  }
  return new Response("not_found", { status: 404 });
}

async function oauth(env: Env): Promise<OAuthHelpers> {
  return env.OAUTH_PROVIDER;
}

async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauthApi = await oauth(env);
  if (request.method === "GET") {
    const parsed = await oauthApi.parseAuthRequest(request);
    const details = await oauthApi.describeConsent(parsed);
    const consent = await oauthApi.beginConsent(parsed);
    const mockUser = isMockMode(env) ? "11111111-1111-4111-8111-111111111111" : null;
    const tier = mockUser ? "complete" : null;
    const planAllowed = mockUser
      ? resolveEntitlement({ enrollmentTier: tier, hasCoachingAssignment: false, mcpPilotAllowed: true }).allowed
      : false;
    if (!isMockMode(env) && env.WEB_APP_ORIGIN) {
      const redirect = new URL("/riset/koneksi-ai/oauth/authorize", env.WEB_APP_ORIGIN);
      redirect.searchParams.set("return_to", request.url);
      return Response.redirect(redirect.toString(), 302);
    }
    consent.headers.set("Content-Type", "text/html; charset=utf-8");
    consent.headers.set("X-Frame-Options", "DENY");
    return new Response(renderConsentPage(details, consent.handle, { planAllowed }), { headers: consent.headers });
  }
  if (request.method === "POST") {
    const form = await request.formData();
    const handle = String(form.get("handle"));
    if (form.get("decision") !== "approve") {
      const denied = await oauthApi.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauthApi.approveConsent(request, handle, { scope: approvedScopes(form) });
    const userId = isMockMode(env) ? "11111111-1111-4111-8111-111111111111" : await resolveUserIdFromSession(request, env);
    if (!userId) return new Response("login_required", { status: 401 });
    const completed = await oauthApi.completeAuthorization({
      request: approved.request,
      userId,
      metadata: {},
      scope: approved.request.scope,
      props: { userId, upstreamAccessToken: isMockMode(env) ? "mock-upstream-jwt" : undefined },
    });
    approved.headers.set("Location", completed.redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  }
  return new Response("method_not_allowed", { status: 405 });
}

function approvedScopes(form: FormData): string[] {
  const values = form.getAll("scope").map(String);
  return values.length ? values : ["sr.read", "offline_access"];
}

async function resolveUserIdFromSession(_request: Request, _env: Env): Promise<string | null> {
  // Staging/prod: user id comes from auctus.academy after Supabase login (not implemented in Phase 0 scaffold).
  return null;
}

async function handleUpstreamCallback(request: Request, env: Env): Promise<Response> {
  if (isMockMode(env)) {
    return Response.json({ status: "mock", message: "upstream supabase oauth stub" });
  }
  return new Response("not_implemented", { status: 501 });
}