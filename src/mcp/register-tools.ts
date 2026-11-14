import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_SCOPES, SERVER_INSTRUCTIONS } from "../config";
import { resolveEntitlement, scopeIncludes } from "../entitlement";
import type { ToolContext } from "../data/port";
import * as port from "../data/port";
import { PHASE0_TOOLS } from "./catalog";

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