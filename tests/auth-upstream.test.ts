import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthError } from "@cloudflare/workers-oauth-provider";
import { approvedScopes } from "../src/auth/default-handler";
import { jwtHasClientId } from "../src/auth/connections-api";
import { checkUpstreamSession } from "../src/auth/session-check";
import {
  buildUpstreamAuthorizeUrl,
  createPkcePair,
  exchangeUpstreamCode,
  refreshUpstream,
  UpstreamError,
  type UpstreamConfig,
} from "../src/auth/upstream";
import { mapRpcError } from "../src/data/supabase";
import { VENDORED_DEDUP_SHA256 } from "../src/dedup/vendored-hashes";
import { tokenExchangeCallback } from "../src/index";
import { checkMcpHeaders } from "../src/mcp/handler";

const cfg: UpstreamConfig = {
  supabaseUrl: "https://example.supabase.co",
  clientId: "auctus-mcp-gateway",
  clientSecret: "s3cret",
  redirectUri: "https://auth.mcp.example/consent/upstream-callback",
};

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

afterEach(() => vi.unstubAllGlobals());

describe("upstream Supabase OAuth", () => {
  it("authorize URL uses PKCE S256 and the fixed redirect", async () => {
    const pkce = await createPkcePair();
    const url = new URL(buildUpstreamAuthorizeUrl(cfg, "st", pkce.challenge));
    expect(url.pathname).toBe("/auth/v1/oauth/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(pkce.challenge).not.toBe(pkce.verifier);
  });

  it("code exchange authenticates the confidential client with Basic auth", async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    const tokens = await exchangeUpstreamCode(cfg, "code", "verifier", fetchMock as unknown as typeof fetch);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("auctus-mcp-gateway:s3cret")}`);
    expect(String(init.body)).toContain("code_verifier=verifier");
    expect(tokens.refresh_token).toBe("r");
  });

  it("a refused refresh is upstream_rejected", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 400 }));
    await expect(refreshUpstream(cfg, "old", fetchMock as unknown as typeof fetch)).rejects.toMatchObject({ code: "upstream_rejected" });
  });

  it("MCP refresh revokes the grant when Supabase ended the session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    const env = { MOCK_MODE: "0", SUPABASE_URL: cfg.supabaseUrl, SUPABASE_OAUTH_CLIENT_ID: "x", SUPABASE_OAUTH_CLIENT_SECRET: "y", SUPABASE_OAUTH_REDIRECT_URI: cfg.redirectUri } as Env;
    const props = { userId: "u", upstream: { access_token: "a", refresh_token: "r", expires_at: 0 } };
    const err = await tokenExchangeCallback({ grantType: "refresh_token", props, env } as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).code).toBe("invalid_grant");
  });

  it("MCP refresh keeps a still-fresh upstream token", async () => {
    const env = { MOCK_MODE: "0" } as Env;
    const props = { userId: "u", upstream: { access_token: "a", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3000 } };
    expect(await tokenExchangeCallback({ grantType: "refresh_token", props, env } as never)).toBeUndefined();
  });

  it("session check reports a revoked upstream session", async () => {
    const kv = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;
    const env = { MOCK_MODE: "0", SUPABASE_URL: cfg.supabaseUrl, MCP_OPS: kv } as Env;
    const fetchMock = vi.fn(async () => new Response("{}", { status: 403 }));
    expect(await checkUpstreamSession(env, "g", "u", "tok", fetchMock as unknown as typeof fetch)).toBe("revoked");
  });

  it("UpstreamError carries only a code", () => {
    expect(new UpstreamError("upstream_unavailable").message).toBe("upstream_unavailable");
  });
});

describe("consent and connections", () => {
  it("only supported scopes can be approved, sr.read is the floor", () => {
    const form = new FormData();
    form.append("scope", "saring.write");
    form.append("scope", "admin.everything");
    expect(approvedScopes(form)).toEqual(["saring.write"]);
    expect(approvedScopes(new FormData())).toEqual(["sr.read"]);
  });

  it("connections API refuses gateway tokens", () => {
    expect(jwtHasClientId(`h.${b64url({ sub: "u", client_id: "auctus-mcp-gateway" })}.s`)).toBe(true);
    expect(jwtHasClientId(`h.${b64url({ sub: "u" })}.s`)).toBe(false);
    expect(jwtHasClientId("not-a-jwt")).toBe(true);
  });
});

describe("transport guards", () => {
  it("rejects Mcp-Method / Mcp-Name that do not match the body", () => {
    const h = new Headers({ "Mcp-Method": "tools/call", "Mcp-Name": "auctus_whoami" });
    expect(checkMcpHeaders(h, { method: "tools/call", params: { name: "auctus_saring_propose_decisions" } })).toBe("mcp_name_mismatch");
    expect(checkMcpHeaders(h, { method: "tools/call", params: { name: "auctus_whoami" } })).toBeNull();
    expect(checkMcpHeaders(new Headers({ "Mcp-Method": "tools/list" }), { method: "tools/call" })).toBe("mcp_method_mismatch");
    expect(checkMcpHeaders(new Headers(), [{ method: "tools/call" }])).toBe("batch_not_supported");
  });

  it("maps database refusals to safe codes", () => {
    expect(mapRpcError(400, { code: "P0001", message: "mcp:revert_conflict" }).code).toBe("revert_conflict");
    expect(mapRpcError(403, { code: "42501", message: "mcp:gateway_forbidden" }).code).toBe("gateway_forbidden");
    expect(mapRpcError(400, { code: "P0001", message: "ma_job_busy" }).code).toBe("ma_job_busy");
    expect(mapRpcError(500, { message: "relation secret does not exist" }).code).toBe("upstream_error");
  });
});

describe("vendored dedup engine", () => {
  it("matches the recorded auctus-academy hashes", () => {
    for (const f of ["engine.ts", "types.ts"] as const) {
      const text = readFileSync(new URL(`../src/dedup/${f}`, import.meta.url), "utf8");
      const body = text.split("\n").slice(3).join("\n");
      expect(createHash("sha256").update(body).digest("hex"), f).toBe(VENDORED_DEDUP_SHA256[f]);
    }
  });
});

describe("upstream URL policy", async () => {
  const { isAllowedSupabaseUrl } = await import("../src/auth/upstream");
  it("allows https and loopback http only", () => {
    expect(isAllowedSupabaseUrl("https://x.supabase.co")).toBe(true);
    expect(isAllowedSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isAllowedSupabaseUrl("http://x.supabase.co")).toBe(false);
    expect(isAllowedSupabaseUrl("not a url")).toBe(false);
  });
});

describe("consent page CSP", async () => {
  const { formActionSources, renderConsentPage } = await import("../src/auth/consent-page");
  it("allows exactly the redirect chain origins (Chrome applies form-action to redirects)", () => {
    expect(formActionSources(["http://127.0.0.1:9999/callback", "https://x.supabase.co", "https://auctus.academy", undefined, "nope"])).toEqual([
      "http://127.0.0.1:9999",
      "https://x.supabase.co",
      "https://auctus.academy",
    ]);
    expect(formActionSources(["cursor://anysphere.cursor-deeplink/mcp/cb"])).toEqual(["cursor:"]);
    const html = renderConsentPage(
      { clientName: "<b>x</b>", clientDomain: undefined, redirectHost: "127.0.0.1", redirectIsLoopback: true, scope: ["sr.read", "evil.scope"] } as never,
      "h",
      ["https://x.supabase.co"],
    );
    expect(html).toContain("form-action 'self' https://x.supabase.co;");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("evil.scope");
  });
});
