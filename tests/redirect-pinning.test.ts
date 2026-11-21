import { describe, expect, it } from "vitest";
import { PINNED_REDIRECT_URIS } from "../src/config";
import { isLoopbackHost, isRedirectAllowed, parseAndValidateRedirectUri } from "../src/security/redirect-uri";

const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect";
const CURSOR = "https://www.cursor.com/agents/mcp/oauth/callback";

describe("pinned redirect URIs (pentest F6)", () => {
  it("pins exactly the documented vendor callbacks", () => {
    expect([...PINNED_REDIRECT_URIS].sort()).toEqual([CHATGPT, CLAUDE, CURSOR].sort());
  });

  it.each([CLAUDE, CHATGPT, CURSOR])("allows the exact URI %s", (uri) => {
    expect(isRedirectAllowed(uri)).toBe(true);
  });

  it.each([
    ["other path on the same host", "https://claude.ai/other"],
    ["open-redirect style path on the same host", "https://claude.ai/logout?next=https://evil.example"],
    ["trailing slash", `${CLAUDE}/`],
    ["extra path segment", `${CLAUDE}/x`],
    ["dot segments", "https://claude.ai/api/mcp/../mcp/auth_callback"],
    ["query string", `${CLAUDE}?x=1`],
    ["fragment", `${CLAUDE}#x`],
    ["empty fragment", `${CLAUDE}#`],
    ["upper-case host spelling", "HTTPS://CLAUDE.AI/api/mcp/auth_callback"],
    ["subdomain", "https://www.claude.ai/api/mcp/auth_callback"],
    ["lookalike suffix", "https://claude.ai.evil.example/api/mcp/auth_callback"],
    ["other TLD", "https://claude.com/api/mcp/auth_callback"],
    ["explicit port", "https://claude.ai:8443/api/mcp/auth_callback"],
    ["userinfo", "https://user@claude.ai/api/mcp/auth_callback"],
    ["http scheme on a pinned host", "http://claude.ai/api/mcp/auth_callback"],
    ["ChatGPT per-connector form", "https://chatgpt.com/connector/oauth/abc123"],
    ["ChatGPT path prefix", `${CHATGPT}/x`],
    ["Cursor without www", "https://cursor.com/agents/mcp/oauth/callback"],
    ["Cursor other path", "https://www.cursor.com/agents/mcp/oauth/other"],
    ["Grok (docs name no callback, stays off)", "https://grok.com/connectors/oauth/callback"],
    ["xAI host", "https://x.ai/callback"],
    ["custom scheme", "cursor://anysphere.cursor-retrieval/oauth/callback"],
    ["javascript scheme", "javascript:alert(1)"],
    ["https on loopback", "https://127.0.0.1:9999/callback"],
    ["https localhost", "https://localhost/callback"],
    ["not a URL", "nope"],
  ])("refuses %s", (_label, uri) => {
    expect(isRedirectAllowed(uri)).toBe(false);
  });

  it("refuses empty input", () => {
    expect(isRedirectAllowed(undefined)).toBe(false);
    expect(isRedirectAllowed(null)).toBe(false);
    expect(isRedirectAllowed("")).toBe(false);
  });
});

describe("loopback redirects (RFC 8252)", () => {
  it.each([
    "http://127.0.0.1:9999/callback",
    "http://127.0.0.1/callback",
    "http://localhost:8787/callback",
    "http://localhost:3118/callback",
    "http://[::1]:5000/callback",
  ])("allows %s", (uri) => {
    expect(isRedirectAllowed(uri)).toBe(true);
  });

  it.each([
    "http://127.0.0.1.evil.example/callback",
    "http://localhost.evil.example/callback",
    "http://127.0.0.1@evil.example/callback",
    "http://0.0.0.0:9999/callback",
    "http://192.168.1.10:9999/callback",
    "http://example.com/callback",
    "http://127.0.0.1:9999/callback#frag",
  ])("refuses %s", (uri) => {
    expect(isRedirectAllowed(uri)).toBe(false);
  });

  it("recognises loopback host spellings", () => {
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("localhost.evil.example")).toBe(false);
  });
});

describe("parseAndValidateRedirectUri", () => {
  it("accepts a pinned URI that is registered exactly", () => {
    expect(parseAndValidateRedirectUri(CLAUDE, [CLAUDE])).toMatchObject({ ok: true, host: "claude.ai", isLoopback: false });
  });

  it("accepts a registered loopback URI", () => {
    expect(parseAndValidateRedirectUri("http://127.0.0.1:9999/callback", ["http://127.0.0.1:9999/callback"])).toMatchObject({ ok: true, isLoopback: true });
  });

  it("refuses a pinned URI that was not registered", () => {
    expect(parseAndValidateRedirectUri(CLAUDE, [CHATGPT])).toEqual({ ok: false, reason: "redirect_uri_mismatch" });
  });

  it("refuses an unpinned URI even when it was registered", () => {
    const uri = "https://claude.ai/other";
    expect(parseAndValidateRedirectUri(uri, [uri])).toEqual({ ok: false, reason: "redirect_not_pinned" });
  });

  it("refuses http on a remote host", () => {
    const uri = "http://claude.ai/api/mcp/auth_callback";
    expect(parseAndValidateRedirectUri(uri, [uri])).toEqual({ ok: false, reason: "http_only_loopback" });
  });
});
