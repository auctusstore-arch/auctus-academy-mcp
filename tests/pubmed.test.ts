import { describe, expect, it } from "vitest";
import { pubmedAuditArgsHash } from "../src/pubmed/audit-args";
import { mockPubmedGetArticles, mockPubmedSearch } from "../src/pubmed/mock";
import { capJsonResponse } from "../src/pubmed/response-cap";
import { toolPubmedGetArticles, toolPubmedSearch, toolPubmedMeshLookup } from "../src/pubmed/service";
import type { ToolContext } from "../src/data/port";
import { NCBI_EUTILS_ORIGIN } from "../src/pubmed/constants";
import { ncbiGet, PubMedClientError } from "../src/pubmed/ncbi-client";
import { checkNcbiGlobalRateLimit, checkPubMedUserRateLimit } from "../src/security/rate-limit";

function mockCtx(): ToolContext {
  const kv = {
    async get() {
      return null;
    },
    async put() {
      return;
    },
  } as unknown as KVNamespace;
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    scopes: ["sr.read"],
    clientId: "test-client",
    env: { MOCK_MODE: "1", MCP_OPS: kv } as Env,
  };
}

describe("pubmed mock tools", () => {
  it("search returns capped pmids", async () => {
    const res = await toolPubmedSearch(mockCtx(), { query: "diabetes", max_results: 2 });
    expect(res.pmids.length).toBeLessThanOrEqual(2);
    expect(res.query_echo.length).toBeGreaterThan(0);
  });

  it("get_articles wraps injection heuristic", async () => {
    const res = await toolPubmedGetArticles(mockCtx(), ["12345678"]);
    const first = res.articles[0];
    expect(first).toBeDefined();
    expect(first!.abstract._meta.injection_heuristic_flags.length).toBeGreaterThan(0);
    expect(first!.abstract.untrusted_content).toBeDefined();
  });

  it("mesh lookup returns fixture", async () => {
    const res = await toolPubmedMeshLookup(mockCtx(), { term: "Diabetes Mellitus" });
    expect(res.terms.length).toBeGreaterThan(0);
  });
});

describe("pubmed audit privacy", () => {
  it("hashes query instead of storing plaintext", async () => {
    const { argsHash } = await pubmedAuditArgsHash("auctus_pubmed_search", {
      query: "secret query text",
      max_results: 5,
    });
    expect(argsHash).toBeTruthy();
    expect(argsHash).not.toContain("secret");
  });
});

describe("pubmed caps", () => {
  it("mock get rejects >20 pmids", async () => {
    const pmids = Array.from({ length: 21 }, (_, i) => String(1000 + i));
    await expect(toolPubmedGetArticles(mockCtx(), pmids)).rejects.toThrow("invalid_input");
  });

  it("response cap truncates huge payloads", () => {
    const big = { articles: mockPubmedGetArticles(Array.from({ length: 20 }, () => "1")) };
    const { body, truncated } = capJsonResponse(big);
    expect(body.length).toBeLessThanOrEqual(100_050);
    if (JSON.stringify(big, null, 2).length > 100_000) expect(truncated).toBe(true);
  });
});

describe("ncbi client SSRF guard", () => {
  it("blocks non-NCBI paths", async () => {
    await expect(
      ncbiGet("//evil.example/entrez/eutils/esearch.fcgi", { db: "pubmed" }, { tool: "t", email: "e@e.com" }),
    ).rejects.toBeInstanceOf(PubMedClientError);
  });

  it("allows only eutils host", () => {
    expect(NCBI_EUTILS_ORIGIN).toBe("https://eutils.ncbi.nlm.nih.gov");
  });
});

describe("pubmed rate limit keys", () => {
  it("allows first bucket entry in memory kv", async () => {
    const store = new Map<string, string>();
    const kv = {
      async get(key: string) {
        const v = store.get(key);
        return v ? JSON.parse(v) : null;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
    } as unknown as KVNamespace;
    const user = await checkPubMedUserRateLimit(kv, "u1", "c1");
    expect(user.allowed).toBe(true);
    const global = await checkNcbiGlobalRateLimit(kv);
    expect(global.allowed).toBe(true);
  });
});

describe("mockPubmedSearch", () => {
  it("returns deterministic fixture", async () => {
    const r = await mockPubmedSearch("q", 3);
    expect(r.total).toBe(3);
  });
});