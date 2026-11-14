import { describe, expect, it } from "vitest";
import { parseAndValidateRedirectUri } from "../src/security/redirect-uri";

describe("redirect URI validation", () => {
  it("rejects non-exact redirect", () => {
    const result = parseAndValidateRedirectUri("https://claude.ai/other", ["https://claude.ai/api/mcp/auth_callback"]);
    expect(result.ok).toBe(false);
  });

  it("allows exact https redirect on allowlisted host", () => {
    const uri = "https://claude.ai/api/mcp/auth_callback";
    const result = parseAndValidateRedirectUri(uri, [uri]);
    expect(result.ok).toBe(true);
  });

  it("rejects non-allowlisted host", () => {
    const uri = "https://evil.example/cb";
    const result = parseAndValidateRedirectUri(uri, [uri]);
    expect(result.ok).toBe(false);
  });
});