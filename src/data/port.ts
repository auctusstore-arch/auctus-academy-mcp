import { isMockMode } from "../config";
import {
  mockCanAccessProject,
  mockCheckReady,
  mockGetJob,
  mockGrade,
  mockListJobs,
  mockListRecords,
  mockListSaringProjects,
  mockMaPaper,
  mockMaPapers,
  mockOutcomeData,
  mockProjectSummary,
  mockRob,
  mockWhoami,
} from "./mock-store";

import type { AuditEventInput } from "../audit/logger";

export type ToolContext = {
  userId: string;
  scopes: string[];
  clientId: string;
  env: Env;
  upstreamAccessToken?: string;
  /** Optional per-tool audit hook (PubMed redacted args). */
  auditTool?: (partial: Pick<AuditEventInput, "tool" | "argsHash" | "status" | "recordCount">) => Promise<void>;
};

async function assertProject(ctx: ToolContext, projectId: string): Promise<void> {
  const ok = await mockCanAccessProject(ctx.userId, projectId);
  if (!ok) throw new Error("forbidden");
}

export async function toolWhoami(ctx: ToolContext) {
  if (isMockMode(ctx.env)) return mockWhoami(ctx.userId, ctx.scopes);
  throw new Error("supabase_port_not_wired");
}

export async function toolSaringListProjects(ctx: ToolContext) {
  if (isMockMode(ctx.env)) return { projects: mockListSaringProjects(ctx.userId) };
  throw new Error("supabase_port_not_wired");
}

export async function toolSaringProjectSummary(ctx: ToolContext, projectId: string) {
  await assertProject(ctx, projectId);
  if (isMockMode(ctx.env)) return mockProjectSummary(ctx.userId, projectId);
  throw new Error("supabase_port_not_wired");
}

export async function toolSaringListRecords(ctx: ToolContext, input: { project_id: string; limit?: number }) {
  await assertProject(ctx, input.project_id);
  const limit = Math.min(input.limit ?? 50, 50);
  if (isMockMode(ctx.env)) return { records: mockListRecords(ctx.userId, input.project_id, limit) };
  throw new Error("supabase_port_not_wired");
}

export async function toolSaringGetRecord(ctx: ToolContext, input: { project_id: string; record_id: string }) {
  await assertProject(ctx, input.project_id);
  if (isMockMode(ctx.env)) {
    const row = mockListRecords(ctx.userId, input.project_id).find((r) => r.record_id === input.record_id);
    if (!row) throw new Error("not_found");
    return row;
  }
  throw new Error("supabase_port_not_wired");
}

export async function toolMaListPapers(ctx: ToolContext) {
  if (isMockMode(ctx.env)) return { papers: mockMaPapers(ctx.userId) };
  throw new Error("supabase_port_not_wired");
}

export async function toolMaGetPaper(ctx: ToolContext, paperId: string) {
  if (isMockMode(ctx.env)) return mockMaPaper(ctx.userId, paperId);
  throw new Error("supabase_port_not_wired");
}

export async function toolMaGetOutcomeData(ctx: ToolContext, outcomeId: string) {
  if (isMockMode(ctx.env)) return mockOutcomeData(ctx.userId, outcomeId);
  throw new Error("supabase_port_not_wired");
}

export async function toolMaGetRob(ctx: ToolContext, outcomeId: string) {
  if (isMockMode(ctx.env)) return mockRob(ctx.userId, outcomeId);
  throw new Error("supabase_port_not_wired");
}

export async function toolMaGetGrade(ctx: ToolContext, outcomeId: string) {
  if (isMockMode(ctx.env)) return mockGrade(ctx.userId, outcomeId);
  throw new Error("supabase_port_not_wired");
}

export async function toolMaCheckReady(ctx: ToolContext, outcomeId: string) {
  if (isMockMode(ctx.env)) return mockCheckReady(ctx.userId, outcomeId);
  throw new Error("supabase_port_not_wired");
}

export async function toolMaListJobs(ctx: ToolContext, outcomeId: string) {
  if (isMockMode(ctx.env)) return { jobs: mockListJobs(ctx.userId, outcomeId) };
  throw new Error("supabase_port_not_wired");
}

export async function toolMaGetJob(ctx: ToolContext, jobId: string) {
  if (isMockMode(ctx.env)) return mockGetJob(ctx.userId, jobId);
  throw new Error("supabase_port_not_wired");
}