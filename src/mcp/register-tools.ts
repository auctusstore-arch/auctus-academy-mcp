import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_SCOPES, SERVER_INSTRUCTIONS } from "../config";
import { resolveEntitlement, scopeIncludes } from "../entitlement";
import type { ToolContext } from "../data/port";
import * as port from "../data/port";
import { PHASE0_TOOLS } from "./catalog";
import { pubmedAuditArgsHash } from "../pubmed/audit-args";
import { capJsonResponse } from "../pubmed/response-cap";
import * as pubmed from "../pubmed/service";

const uuid = z.string().uuid();

export function createMcpServer(getContext: () => ToolContext): McpServer {
  const server = new McpServer(
    { name: "auctus-mcp", version: "0.0.1-phase0" },
    { instructions: SERVER_INSTRUCTIONS, maxToolInputElements: 256 },
  );

  for (const def of PHASE0_TOOLS) {
    // Annotations attached per tool below
    void def;
  }

  server.registerTool(
    "auctus_whoami",
    {
      description: "Returns MCP entitlements, plan basis, scopes, and MA quota.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => runTool(getContext, async (ctx) => port.toolWhoami(ctx)),
  );

  server.registerTool(
    "auctus_saring_list_projects",
    {
      description: "List accessible Saring projects with role.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => runTool(getContext, async (ctx) => port.toolSaringListProjects(ctx)),
  );

  server.registerTool(
    "auctus_saring_project_summary",
    {
      description: "Project summary counts (no collaborator email).",
      inputSchema: z.object({ project_id: uuid }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, _extra) => runTool(getContext, async (ctx) => port.toolSaringProjectSummary(ctx, args.project_id)),
  );

  server.registerTool(
    "auctus_saring_list_records",
    {
      description: "Paginated records; abstracts in untrusted_content.",
      inputSchema: z.object({
        project_id: uuid,
        status: z.enum(["undecided", "include", "maybe", "exclude"]).optional(),
        query: z.string().max(200).optional(),
        cursor: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, _extra) => runTool(getContext, async (ctx) => port.toolSaringListRecords(ctx, args)),
  );

  server.registerTool(
    "auctus_saring_get_record",
    {
      description: "Fetch one screening record.",
      inputSchema: z.object({ project_id: uuid, record_id: z.string().min(1).max(120) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, _extra) => runTool(getContext, async (ctx) => port.toolSaringGetRecord(ctx, args)),
  );

  server.registerTool(
    "auctus_ma_list_papers",
    {
      description: "List user's MA papers.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => runTool(getContext, async (ctx) => port.toolMaListPapers(ctx)),
  );

  server.registerTool(
    "auctus_ma_get_paper",
    {
      description: "Paper details and outcomes.",
      inputSchema: z.object({ paper_id: uuid }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, _extra) => runTool(getContext, async (ctx) => port.toolMaGetPaper(ctx, args.paper_id)),
  );

  server.registerTool(
    "auctus_ma_get_outcome_data",
    {
      description: "Outcome extraction rows.",
      inputSchema: z.object({ outcome_id: uuid }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, _extra) => runTool(getContext, async (ctx) => port.toolMaGetOutcomeData(ctx, args.outcome_id)),
  );

  server.registerTool(
    "auctus_ma_get_rob",
    {
      description: "Risk of bias data.",
      inputSchema: z.object({ outcome_id: uuid }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, _extra) => runTool(getContext, async (ctx) => port.toolMaGetRob(ctx, args.outcome_id)),
  );

  server.registerTool(
    "auctus_ma_get_grade",
    {
      description: "GRADE ratings.",
      inputSchema: z.object({ outcome_id: uuid }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, _extra) => runTool(getContext, async (ctx) => port.toolMaGetGrade(ctx, args.outcome_id)),
  );

  server.registerTool(
    "auctus_ma_check_ready",
    {
      description: "Read-only MA readiness check.",
      inputSchema: z.object({ outcome_id: uuid }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, _extra) => runTool(getContext, async (ctx) => port.toolMaCheckReady(ctx, args.outcome_id)),
  );

  server.registerTool(
    "auctus_ma_list_jobs",
    {
      description: "List jobs for an outcome (no download URLs).",
      inputSchema: z.object({ outcome_id: uuid }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, _extra) => runTool(getContext, async (ctx) => port.toolMaListJobs(ctx, args.outcome_id)),
  );

  server.registerTool(
    "auctus_ma_get_job",
    {
      description: "Job summary (no download URLs).",
      inputSchema: z.object({ job_id: uuid }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, _extra) => runTool(getContext, async (ctx) => port.toolMaGetJob(ctx, args.job_id)),
  );

  const pubmedAnnotations = {
    readOnlyHint: true as const,
    destructiveHint: false as const,
    idempotentHint: false as const,
    openWorldHint: true as const,
  };

  server.registerTool(
    "auctus_pubmed_search",
    {
      description: "Search PubMed (NCBI E-utilities). Returns PMIDs; query text is third-party.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        max_results: z.number().int().min(1).max(25).optional(),
        min_date: z.string().regex(/^\d{4}(\/\d{2}(\/\d{2})?)?$/).optional(),
        max_date: z.string().regex(/^\d{4}(\/\d{2}(\/\d{2})?)?$/).optional(),
        publication_types: z.array(z.string().max(80)).max(5).optional(),
        sort: z.enum(["relevance", "pub_date"]).optional(),
      }),
      annotations: { ...pubmedAnnotations, idempotentHint: false },
    },
    async (args, _extra) =>
      runPubMedTool(getContext, "auctus_pubmed_search", args, async (ctx) => pubmed.toolPubmedSearch(ctx, args)),
  );

  server.registerTool(
    "auctus_pubmed_get_articles",
    {
      description: "Batch-fetch PubMed articles; title/abstract in untrusted_content.",
      inputSchema: z.object({
        pmids: z.array(z.string().regex(/^\d+$/)).min(1).max(20),
      }),
      annotations: { ...pubmedAnnotations, idempotentHint: true },
    },
    async (args, _extra) =>
      runPubMedTool(getContext, "auctus_pubmed_get_articles", args, async (ctx) =>
        pubmed.toolPubmedGetArticles(ctx, args.pmids),
      ),
  );

  server.registerTool(
    "auctus_pubmed_mesh_lookup",
    {
      description: "MeSH term lookup via NCBI (open-world third-party labels).",
      inputSchema: z.object({
        term: z.string().min(1).max(200),
        max_results: z.number().int().min(1).max(15).optional(),
      }),
      annotations: { ...pubmedAnnotations, idempotentHint: true },
    },
    async (args, _extra) =>
      runPubMedTool(getContext, "auctus_pubmed_mesh_lookup", args, async (ctx) => pubmed.toolPubmedMeshLookup(ctx, args)),
  );

  server.registerTool(
    "auctus_pubmed_verify_pmids",
    {
      description:
        "Check that PMIDs exist on PubMed (catch invented citations). Returns found flag, date, publication types, and is_review per PMID; titles are untrusted.",
      inputSchema: z.object({
        pmids: z.array(z.string().regex(/^\d{1,9}$/)).min(1).max(50),
      }),
      annotations: { ...pubmedAnnotations, idempotentHint: true },
    },
    async (args, _extra) =>
      runPubMedTool(getContext, "auctus_pubmed_verify_pmids", args, async (ctx) =>
        pubmed.toolPubmedVerifyPmids(ctx, args.pmids),
      ),
  );

  server.registerTool(
    "auctus_pubmed_find_related",
    {
      description:
        "PMIDs linked to one article: similar articles, articles citing it (cited_by), or its references. PMIDs only; fetch details with auctus_pubmed_verify_pmids or auctus_pubmed_get_articles.",
      inputSchema: z.object({
        pmid: z.string().regex(/^\d{1,9}$/),
        relation: z.enum(["similar", "cited_by", "references"]),
        max_results: z.number().int().min(1).max(25).optional(),
      }),
      annotations: { ...pubmedAnnotations, idempotentHint: true },
    },
    async (args, _extra) =>
      runPubMedTool(getContext, "auctus_pubmed_find_related", args, async (ctx) => pubmed.toolPubmedFindRelated(ctx, args)),
  );

  return server;
}

async function runTool<T>(getContext: () => ToolContext, fn: (ctx: ToolContext) => Promise<T>) {
  const ctx = getContext();
  if (!ctx.userId) throw new Error("unauthorized");
  if (!scopeIncludes(MCP_SCOPES.SR_READ, ctx.scopes)) {
    throw new Error("insufficient_scope");
  }
  const who = await port.toolWhoami(ctx);
  const ent = resolveEntitlement({
    enrollmentTier: who.entitlement.tier ?? null,
    hasCoachingAssignment: who.entitlement.basis === "coaching_assignment",
    mcpPilotAllowed: who.mcp_pilot.allowed,
  });
  if (!ent.allowed) throw new Error("plan_denied");
  const result = await fn(ctx);
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

async function runPubMedTool<T>(
  getContext: () => ToolContext,
  toolName: string,
  rawArgs: Record<string, unknown>,
  fn: (ctx: ToolContext) => Promise<T>,
) {
  const auditMeta = await pubmedAuditArgsHash(toolName, rawArgs);
  try {
    const out = await runTool(getContext, fn);
    await getContext().auditTool?.({
      tool: toolName,
      argsHash: auditMeta.argsHash,
      status: "ok",
      recordCount: auditMeta.recordCount,
    });
    const text = out.content[0]?.type === "text" ? out.content[0].text : JSON.stringify(out);
    const parsed = JSON.parse(text) as unknown;
    const capped = capJsonResponse(parsed);
    return { content: [{ type: "text" as const, text: capped.body }] };
  } catch (e) {
    await getContext().auditTool?.({
      tool: toolName,
      argsHash: auditMeta.argsHash,
      status: "error",
      recordCount: auditMeta.recordCount,
    });
    const safe =
      e instanceof Error &&
      ["rate_limited", "invalid_input", "pubmed_unavailable", "plan_denied", "insufficient_scope", "unauthorized"].includes(
        e.message,
      )
        ? e.message
        : "pubmed_unavailable";
    throw new Error(safe);
  }
}