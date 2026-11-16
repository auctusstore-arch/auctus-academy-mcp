import { describe, expect, it } from "vitest";
import { createMockDb, createMockRpc, MOCK_IDS, type MockDb } from "../src/data/mock-rpc";
import type { ToolContext, WhoamiRow } from "../src/data/port";
import { runSpec, safeErrorCode } from "../src/mcp/register-tools";
import { TOOL_BY_NAME, TOOLS } from "../src/mcp/tools";
import { CATALOG } from "../src/mcp/catalog";
import { SupabaseRpcError } from "../src/data/supabase";

const memoryKv = () => {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const v = store.get(key);
      return v == null ? null : type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
};

function setup(user: string = MOCK_IDS.USER_A, scopes = ["sr.read", "saring.write", "ma.write", "ma.run", "dedup.run"], db: MockDb = createMockDb()) {
  const rpc = createMockRpc(db, user);
  const ctx: ToolContext = {
    userId: user,
    scopes,
    clientId: "claude",
    env: { MOCK_MODE: "1", MCP_OPS: memoryKv() } as Env,
    rpc,
    client: { id: "claude", name: "Claude" },
    auditTool: async () => undefined,
  };
  const whoami = () => rpc<WhoamiRow>("whoami");
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const spec = TOOL_BY_NAME.get(name);
    if (!spec) throw new Error(`no tool ${name}`);
    const res = await runSpec(spec, ctx, args, whoami);
    const body = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
    return { error: "isError" in res && res.isError ? (body.error as string) : null, body };
  };
  return { ctx, call, db };
}

describe("catalog", () => {
  it("every tool has the auctus_ prefix, a scope, and honest read-only hints", () => {
    for (const t of TOOLS) {
      expect(t.name.startsWith("auctus_")).toBe(true);
      expect(t.scopes.length).toBeGreaterThan(0);
      expect(t.annotations.readOnlyHint).toBe(t.level === "read");
    }
    expect(new Set(CATALOG.map((t) => t.name)).size).toBe(TOOLS.length);
  });

  it("covers PRD phases 0, 1 and 2", () => {
    for (const name of [
      "auctus_whoami", "auctus_saring_list_records", "auctus_ma_get_job",
      "auctus_saring_set_decision", "auctus_saring_propose_decisions", "auctus_ma_upsert_rows", "auctus_ma_create_outcome", "auctus_changes_revert",
      "auctus_ma_run_analysis", "auctus_ma_cancel_job", "auctus_ma_get_result_link", "auctus_dedup_analyze_project",
    ]) {
      expect(TOOL_BY_NAME.has(name), name).toBe(true);
    }
  });

  it("exposes no delete, invite, corpus replace or approve tool (W3 is web only)", () => {
    for (const t of TOOLS) expect(t.name).not.toMatch(/delete|invite|approve|upload|export|finalize/);
  });
});

describe("entitlement and scope", () => {
  it("Free user gets nothing", async () => {
    const { call } = setup(MOCK_IDS.USER_FREE);
    expect((await call("auctus_saring_list_projects")).error).toBe("plan_denied");
  });

  it("write without saring.write is refused with the scope to ask for", async () => {
    const { call } = setup(MOCK_IDS.USER_A, ["sr.read"]);
    const res = await call("auctus_saring_set_decision", { project_id: MOCK_IDS.PROJECT_A, record_id: "f1:1", status: "include" });
    expect(res.error).toBe("insufficient_scope");
    expect(res.body.required_scopes).toEqual(["saring.write"]);
  });
});

describe("reads", () => {
  it("user A cannot read user B's project", async () => {
    const { call } = setup();
    expect((await call("auctus_saring_project_summary", { project_id: MOCK_IDS.PROJECT_B })).error).toBe("not_found");
    expect((await call("auctus_saring_list_records", { project_id: MOCK_IDS.PROJECT_B })).error).toBe("not_found");
  });

  it("lists records with untrusted abstracts and a cursor", async () => {
    const { call } = setup();
    const page = await call("auctus_saring_list_records", { project_id: MOCK_IDS.PROJECT_A, limit: 2 });
    expect(page.error).toBeNull();
    const records = page.body.records as Array<{ abstract: { untrusted_content: string; _meta: { injection_heuristic_flags: string[] } } }>;
    expect(records).toHaveLength(2);
    expect(records[0]!.abstract._meta.injection_heuristic_flags.length).toBeGreaterThan(0);
    expect(page.body.next_cursor).toBe("2");
    const next = await call("auctus_saring_list_records", { project_id: MOCK_IDS.PROJECT_A, limit: 2, cursor: "2" });
    expect((next.body.records as unknown[]).length).toBe(1);
  });
});

describe("writes, approval and revert", () => {
  it("one decision applies as W1 and can be reverted", async () => {
    const { call, db } = setup();
    const res = await call("auctus_saring_set_decision", { project_id: MOCK_IDS.PROJECT_A, record_id: "f1:1", status: "include" });
    expect(res.body.status).toBe("applied");
    expect(db.decisions[MOCK_IDS.PROJECT_A]!["f1:1"]!.status).toBe("include");
    const undo = await call("auctus_changes_revert", { change_set_id: res.body.change_set_id });
    expect(undo.body.status).toBe("applied");
    expect(db.decisions[MOCK_IDS.PROJECT_A]!["f1:1"]!.status).toBe("undecided");
  });

  it("splitting excludes into single calls hits the hourly budget (review gap 1)", async () => {
    const { call, db } = setup();
    const statuses: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const res = await call("auctus_saring_set_decision", { project_id: MOCK_IDS.PROJECT_A, record_id: `x:${i}`, status: "exclude" });
      statuses.push(String(res.body.status));
    }
    expect(statuses.slice(0, 5)).toEqual(Array(5).fill("applied"));
    expect(statuses[5]).toBe("pending_approval");
    expect(db.decisions[MOCK_IDS.PROJECT_A]!["x:6"]).toBeUndefined();
  });

  it("bulk over the threshold waits for approval and the model cannot approve", async () => {
    const { call, ctx } = setup();
    const decisions = Array.from({ length: 21 }, (_, i) => ({ record_id: `b:${i}`, status: "include" }));
    const res = await call("auctus_saring_propose_decisions", { project_id: MOCK_IDS.PROJECT_A, decisions });
    expect(res.body.status).toBe("pending_approval");
    expect(String(res.body.approval_path)).toContain("/riset/koneksi-ai/approval/");
    await expect(ctx.rpc("approve_change_set", { p_id: res.body.change_set_id, p_payload_hash: "x" })).rejects.toThrow("web_only");
  });

  it("an analysis run always needs approval", async () => {
    const { call } = setup();
    const res = await call("auctus_ma_run_analysis", { outcome_id: MOCK_IDS.OUTCOME_A });
    expect(res.body.status).toBe("pending_approval");
    expect(res.body.level).toBe("W2");
  });

  it("study upsert keeps existing studies and reverts", async () => {
    const { call, db } = setup();
    const res = await call("auctus_ma_upsert_studies", { paper_id: MOCK_IDS.PAPER_A, studies: [{ firstAuthor: "Lee", year: "2021" }] });
    expect(res.body.status).toBe("applied");
    expect(db.studies[MOCK_IDS.PAPER_A]).toHaveLength(2);
    await call("auctus_changes_revert", { change_set_id: res.body.change_set_id });
    expect(db.studies[MOCK_IDS.PAPER_A]).toHaveLength(1);
  });
});

describe("phase 2", () => {
  it("result link only for files in the job manifest", async () => {
    const { call } = setup();
    const ok = await call("auctus_ma_get_result_link", { job_id: MOCK_IDS.JOB_A, file: "forest.png" });
    expect(String(ok.body.url)).toContain("ma-results");
    expect(ok.body.expires_in_seconds).toBe(120);
    expect((await call("auctus_ma_get_result_link", { job_id: MOCK_IDS.JOB_A, file: "other.png" })).error).toBe("not_found");
  });

  it("dedup returns proposals and checks PMIDs against the corpus", async () => {
    const { call } = setup();
    const analysis = await call("auctus_dedup_analyze_project", { project_id: MOCK_IDS.PROJECT_A });
    expect(analysis.error).toBeNull();
    expect(analysis.body.record_count).toBe(3);
    const check = await call("auctus_dedup_check_pmids", { project_id: MOCK_IDS.PROJECT_A, pmids: ["12345678", "99999999"] });
    const results = check.body.results as Array<{ pmid: string; already_in_project: boolean }>;
    expect(results.find((r) => r.pmid === "12345678")?.already_in_project).toBe(true);
    expect(check.body.not_on_pubmed).toEqual(["99999999"]);
  });
});

describe("error safety", () => {
  it("never leaks unknown error text", () => {
    expect(safeErrorCode(new Error("duplicate key value violates unique constraint secret_table"))).toBe("internal_error");
    expect(safeErrorCode(new SupabaseRpcError("revert_conflict", 400))).toBe("revert_conflict");
    expect(safeErrorCode(new SupabaseRpcError("ma_job_busy", 400))).toBe("ma_job_busy");
  });
});
