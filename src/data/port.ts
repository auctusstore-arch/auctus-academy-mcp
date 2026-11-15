import type { AuditEventInput } from "../audit/logger";
import type { RpcCaller } from "./supabase";

/** Who is calling, as recorded in change sets and audit rows. */
export type ClientMeta = {
  /** The AI client's OAuth client_id at the Auctus AS (not the Supabase gateway id). */
  id: string;
  name?: string;
  /** Hash of the grant id (never the token). */
  grant?: string;
  ua?: string;
  country?: string;
};

export type ToolContext = {
  userId: string;
  scopes: string[];
  clientId: string;
  env: Env;
  /** Calls `mcp.*` RPCs as the user (Supabase) or the in-memory fake (MOCK_MODE). */
  rpc: RpcCaller;
  client: ClientMeta;
  /** Upstream Supabase access token, used only for Storage signing. Absent in mock. */
  upstreamAccessToken?: string;
  /** Optional per-tool audit hook (PubMed redacted args). */
  auditTool?: (partial: Pick<AuditEventInput, "tool" | "argsHash" | "status" | "recordCount">) => Promise<void>;
};

/** Shape returned by `mcp.whoami()`. */
export type WhoamiRow = {
  user_id: string;
  entitlement: {
    tier: string | null;
    basis: "complete" | "coaching_enrollment" | "coaching_assignment" | null;
    allowed: boolean;
    dedup_eligible: boolean;
  };
  ma: { pilot: { enabled: boolean; allowed: boolean }; quota: { maxPapers: number; maxOutcomes: number } } | null;
};

export function clientJson(ctx: ToolContext): Record<string, string | undefined> {
  return { id: ctx.client.id, name: ctx.client.name, grant: ctx.client.grant, ua: ctx.client.ua, country: ctx.client.country };
}
