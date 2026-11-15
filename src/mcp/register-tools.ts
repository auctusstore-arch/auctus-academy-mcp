import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MAX_RESPONSE_BYTES, SERVER_INSTRUCTIONS } from "../config";
import type { ToolContext, WhoamiRow } from "../data/port";
import { SupabaseRpcError } from "../data/supabase";
import { resolveEntitlementFromWhoami } from "../entitlement";
import { createHash } from "../lib/hash";
import { pubmedAuditArgsHash } from "../pubmed/audit-args";
import { checkWriteRateLimit } from "../security/rate-limit";
import { registerResourcesAndPrompts } from "./resources";
import { TOOLS, type ToolSpec } from "./tools";

export const SERVER_VERSION = "0.2.0";

/** Codes the model may see, with an actionable Indonesian hint (PRD §12). */
export const ERROR_HINTS: Record<string, string> = {
  unauthorized: "Sesi tidak valid. Minta user menyambungkan ulang Auctus.",
  plan_denied: "Paket user tidak mendukung fitur ini (Free tidak mendapat MCP).",
  insufficient_scope: "Izin belum diberikan. Minta user menyambungkan ulang Auctus dan mencentang izin yang dibutuhkan.",
  not_found: "Data tidak ditemukan atau bukan milik user.",
  forbidden: "Tidak diizinkan untuk user ini.",
  invalid_input: "Input tidak valid.",
  rate_limited: "Terlalu banyak permintaan. Tunggu sebentar.",
  approval_rate_limited: "Terlalu banyak permintaan persetujuan dalam satu jam.",
  collaborator_mcp_disabled: "Pemilik proyek belum mengizinkan kolaborator memakai AI (MCP) di proyek ini.",
  project_not_ready: "Proyek masih diunggah.",
  revert_conflict: "Data sudah berubah setelah perubahan ini, jadi tidak bisa dibatalkan otomatis. Minta user memeriksa di web.",
  not_revertible: "Perubahan ini tidak bisa dibatalkan lewat MCP.",
  web_only: "Aksi ini hanya bisa dilakukan user di web Auctus.",
  job_not_done: "Job belum selesai.",
  response_too_large: "Hasil terlalu besar. Pakai limit lebih kecil atau filter.",
  pubmed_unavailable: "PubMed sedang tidak bisa dihubungi.",
  corpus_unavailable: "Korpus proyek tidak bisa dibaca saat ini.",
  upstream_unavailable: "Layanan Auctus sedang bermasalah. Coba lagi nanti.",
  too_many_records: "Terlalu banyak record untuk dianalisis.",
};

/** Turns any thrown error into a safe code. Unknown errors never leak details. */
export function safeErrorCode(e: unknown): string {
  if (e instanceof SupabaseRpcError) {
    return ERROR_HINTS[e.code] || /^ma_[a-z_]{2,60}$/.test(e.code) || /^saring_[a-z_]{2,60}$/.test(e.code) ? e.code : "upstream_error";
  }
  if (e instanceof Error && (ERROR_HINTS[e.message] || /^ma_[a-z_]{2,60}$/.test(e.message))) return e.message;
  return "internal_error";
}

function errorResult(code: string, extra?: Record<string, unknown>) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message: ERROR_HINTS[code] ?? code, ...extra }) }],
  };
}

export async function argsHashFor(spec: ToolSpec, args: Record<string, unknown>) {
  if (spec.pubmed) return pubmedAuditArgsHash(spec.name, args);
  return { argsHash: await createHash(JSON.stringify({ tool: spec.name, args })), recordCount: undefined };
}

export async function runSpec(spec: ToolSpec, ctx: ToolContext, args: Record<string, unknown>, whoami: () => Promise<WhoamiRow>) {
  const missing = spec.scopes.filter((s) => !ctx.scopes.includes(s));
  const audit = await argsHashFor(spec, args);
  const log = (status: "ok" | "denied" | "error") =>
    ctx.auditTool?.({ tool: spec.name, argsHash: audit.argsHash, status, recordCount: audit.recordCount }).catch(() => undefined);

  if (missing.length) {
    await log("denied");
    return errorResult("insufficient_scope", { required_scopes: missing });
  }
  try {
    const who = await whoami();
    const ent = resolveEntitlementFromWhoami(who);
    if (!ent.allowed || (spec.dedupTier && !who.entitlement.dedup_eligible)) {
      await log("denied");
      return errorResult("plan_denied");
    }
    if (spec.level !== "read") {
      const rl = await checkWriteRateLimit(ctx.env.MCP_OPS, ctx.userId, ctx.clientId);
      if (!rl.allowed) {
        await log("denied");
        return errorResult("rate_limited", { retry_after_seconds: rl.retryAfterSec });
      }
    }
    const result = await spec.run(ctx, args);
    const text = JSON.stringify(result ?? null, null, 2);
    if (text.length > MAX_RESPONSE_BYTES) {
      await log("error");
      return errorResult("response_too_large");
    }
    // Successful writes are audited inside the same database transaction.
    if (spec.level === "read") await log("ok");
    return { content: [{ type: "text" as const, text }] };
  } catch (e) {
    await log("error");
    return errorResult(safeErrorCode(e));
  }
}

export function createMcpServer(getContext: () => ToolContext): McpServer {
  const server = new McpServer(
    { name: "auctus-mcp", version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  // One whoami per HTTP request, shared by every tool call in it.
  let whoamiMemo: Promise<WhoamiRow> | null = null;
  const whoami = () => (whoamiMemo ??= getContext().rpc<WhoamiRow>("whoami"));

  for (const spec of TOOLS) {
    server.registerTool(
      spec.name,
      { title: spec.title, description: spec.description, inputSchema: spec.input, annotations: spec.annotations },
      async (args: Record<string, unknown>) => runSpec(spec, getContext(), args ?? {}, whoami),
    );
  }
  registerResourcesAndPrompts(server, getContext, whoami);
  return server;
}
