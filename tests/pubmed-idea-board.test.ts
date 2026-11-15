import { describe, expect, it } from "vitest";
import type { ToolContext } from "../src/data/port";
import { PHASE0_TOOLS } from "../src/mcp/catalog";
import { pubmedAuditArgsHash } from "../src/pubmed/audit-args";
import { PUBMED_TOOL_NAMES } from "../src/pubmed/constants";
import { isoFromSortPubDate, parseElink, parseVerifyEsummary } from "../src/pubmed/eutils";
import { toolPubmedFindRelated, toolPubmedVerifyPmids } from "../src/pubmed/service";

function mockCtx(): ToolContext {
  const kv = { async get() { return null; }, async put() { return; } } as unknown as KVNamespace;
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    scopes: ["sr.read"],
    clientId: "test-client",
    env: { MOCK_MODE: "1", MCP_OPS: kv } as Env,
  };
}

describe("auctus_pubmed_verify_pmids", () => {
  it("flags PMIDs PubMed does not have and marks reviews", async () => {
    const res = await toolPubmedVerifyPmids(mockCtx(), ["12345678", "34567890", "99999999"]);
    expect(res.checked).toBe(3);
    expect(res.not_found).toEqual(["99999999"]);
    const review = res.articles.find((a) => a.pmid === "34567890");
    expect(review?.is_review).toBe(true);
    expect(res.articles.find((a) => a.pmid === "12345678")?.is_review).toBe(false);
  });

  it("dedupes and rejects bad or too many PMIDs", async () => {
    const res = await toolPubmedVerifyPmids(mockCtx(), ["12345678", "12345678"]);
    expect(res.checked).toBe(1);
    await expect(toolPubmedVerifyPmids(mockCtx(), ["abc"])).rejects.toThrow("invalid_input");
    const tooMany = Array.from({ length: 51 }, (_, i) => String(10_000_000 + i));
    await expect(toolPubmedVerifyPmids(mockCtx(), tooMany)).rejects.toThrow("invalid_input");
  });

  it("parses esummary like the Idea Board does", () => {
    const body = {
      result: {
        uids: ["111111", "222222"],
        "111111": {
          title: "Statins <i>after</i> stroke.",
          fulljournalname: "Stroke",
          sortpubdate: "2025/11/03 00:00",
          pubtype: ["Meta-Analysis"],
        },
        "222222": { error: "cannot get document summary" },
      },
    };
    const rows = parseVerifyEsummary(body, ["111111", "222222", "333333"]);
    expect(rows[0]).toMatchObject({ found: true, pub_date_iso: "2025-11-03", is_review: true, journal: "Stroke" });
    expect(rows[0]?.title?.untrusted_content).toBe("Statins after stroke.");
    expect(rows[1]?.found).toBe(false);
    expect(rows[2]?.found).toBe(false);
  });

  it("parses only well-formed sort dates", () => {
    expect(isoFromSortPubDate("2024/01/15 00:00")).toBe("2024-01-15");
    expect(isoFromSortPubDate("2024 Jan")).toBeNull();
    expect(isoFromSortPubDate(undefined)).toBeNull();
  });
});

describe("auctus_pubmed_find_related", () => {
  it("returns related PMIDs without the source PMID", async () => {
    const res = await toolPubmedFindRelated(mockCtx(), { pmid: "12345678", relation: "similar", max_results: 1 });
    expect(res.pmids).toHaveLength(1);
    expect(res.pmids).not.toContain("12345678");
    expect(res.capped).toBe(true);
  });

  it("rejects unknown relation", async () => {
    await expect(
      toolPubmedFindRelated(mockCtx(), { pmid: "12345678", relation: "everything" as never }),
    ).rejects.toThrow("invalid_input");
  });

  it("parses elink by linkname and drops non-numeric ids", () => {
    const body = {
      linksets: [
        {
          linksetdbs: [
            { linkname: "pubmed_pubmed", links: ["1", "2"] },
            { linkname: "pubmed_pubmed_citedin", links: ["3", "x<script>", 4] },
          ],
        },
      ],
    };
    expect(parseElink(body, "pubmed_pubmed_citedin")).toEqual(["3", "4"]);
    expect(parseElink({}, "pubmed_pubmed")).toEqual([]);
  });
});

describe("catalog and audit", () => {
  it("lists the new tools as read-only PubMed tools", () => {
    for (const name of ["auctus_pubmed_verify_pmids", "auctus_pubmed_find_related"]) {
      expect(PUBMED_TOOL_NAMES.has(name)).toBe(true);
      expect(PHASE0_TOOLS.find((t) => t.name === name)?.readOnlyHint).toBe(true);
    }
  });

  it("audit keeps relation but not query text", async () => {
    const a = await pubmedAuditArgsHash("auctus_pubmed_find_related", { pmid: "1", relation: "similar" });
    const b = await pubmedAuditArgsHash("auctus_pubmed_find_related", { pmid: "1", relation: "cited_by" });
    expect(a.argsHash).not.toBe(b.argsHash);
  });
});
