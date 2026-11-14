import { createHash } from "../lib/hash";

export type AuditEventInput = {
  userId: string;
  clientId: string;
  clientName?: string;
  grantId?: string;
  tool: string;
  scope: string;
  argsHash: string;
  status: "ok" | "denied" | "error";
  recordCount?: number;
  ipCountry?: string;
  userAgent?: string;
};

export type AuditChainEntry = AuditEventInput & {
  id: string;
  createdAt: string;
  prevHash: string;
  hash: string;
};

export async function hashAuditPayload(event: AuditEventInput, prevHash: string, createdAt: string): Promise<string> {
  const body = JSON.stringify({ ...event, prevHash, createdAt });
  return createHash(body);
}

/** In-memory / mock audit chain for Phase 0 (persisted via Supabase in production). */
export class AuditLogSink {
  private tailHash = "GENESIS";
  private events: AuditChainEntry[] = [];

  async append(event: AuditEventInput): Promise<AuditChainEntry> {
    const createdAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const hash = await hashAuditPayload(event, this.tailHash, createdAt);
    const entry: AuditChainEntry = { ...event, id, createdAt, prevHash: this.tailHash, hash };
    this.tailHash = hash;
    this.events.push(entry);
    return entry;
  }

  list(): readonly AuditChainEntry[] {
    return this.events;
  }

  async verifyChain(): Promise<boolean> {
    let prev = "GENESIS";
    for (const e of this.events) {
      if (e.prevHash !== prev) return false;
      const input: AuditEventInput = {
        userId: e.userId,
        clientId: e.clientId,
        clientName: e.clientName,
        grantId: e.grantId,
        tool: e.tool,
        scope: e.scope,
        argsHash: e.argsHash,
        status: e.status,
        recordCount: e.recordCount,
        ipCountry: e.ipCountry,
        userAgent: e.userAgent,
      };
      const expected = await hashAuditPayload(input, e.prevHash, e.createdAt);
      if (expected !== e.hash) return false;
      prev = e.hash;
    }
    return true;
  }
}

export async function hashToolArgs(args: unknown): Promise<string> {
  return createHash(JSON.stringify(args ?? {}));
}