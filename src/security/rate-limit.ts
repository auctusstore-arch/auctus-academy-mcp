import { DCR_RATE_LIMIT_PER_HOUR, DCR_PLATFORM_RATE_LIMIT_PER_HOUR, READ_RATE_LIMIT_PER_MINUTE, WRITE_RATE_LIMIT_PER_MINUTE } from "../config";
import { NCBI_GLOBAL_RATE_PER_SECOND, PUBMED_USER_RATE_PER_MINUTE } from "../pubmed/constants";

export type RateResult = { allowed: boolean; retryAfterSec?: number };

/**
 * Pentest F5 / Worker crash (Error 1101): a KV get+put counter is not atomic
 * and KV allows about one write per second per key, so bursts both bypassed
 * the limit and threw. Per-minute limits now use the Workers Rate Limiting
 * binding (atomic, no KV). KV is kept only for the hourly DCR limit, and every
 * KV error is contained: the limiter never throws.
 */
async function viaBinding(binding: RateLimit | undefined, key: string, period: number): Promise<RateResult | null> {
  if (!binding) return null;
  try {
    const { success } = await binding.limit({ key });
    return success ? { allowed: true } : { allowed: false, retryAfterSec: period };
  } catch {
    return null;
  }
}

/** Fallback for local dev and tests (MOCK); not atomic, never throws. */
async function viaKv(kv: KVNamespace | undefined, key: string, limit: number, windowMs: number, failOpen: boolean): Promise<RateResult> {
  if (!kv) return { allowed: failOpen };
  try {
    const now = Date.now();
    const existing = await kv.get<{ count: number; resetAt: number }>(key, "json");
    const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    await kv.put(key, JSON.stringify(bucket), { expirationTtl: Math.max(60, Math.ceil(windowMs / 1000) + 5) });
    if (bucket.count > limit) return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    return { allowed: true };
  } catch {
    return { allowed: failOpen, retryAfterSec: failOpen ? undefined : 60 };
  }
}

export async function checkReadRateLimit(env: Env, userId: string, clientId: string): Promise<RateResult> {
  const key = `read:${userId}:${clientId}`;
  return (await viaBinding(env.RL_READ, key, 60)) ?? viaKv(env.MCP_OPS, `rl:${key}`, READ_RATE_LIMIT_PER_MINUTE, 60_000, true);
}

export async function checkWriteRateLimit(env: Env, userId: string, clientId: string): Promise<RateResult> {
  const key = `write:${userId}:${clientId}`;
  return (await viaBinding(env.RL_WRITE, key, 60)) ?? viaKv(env.MCP_OPS, `rl:${key}`, WRITE_RATE_LIMIT_PER_MINUTE, 60_000, false);
}

export async function checkPubMedUserRateLimit(env: Env, userId: string, clientId: string): Promise<RateResult> {
  const key = `pubmed:${userId}:${clientId}`;
  return (await viaBinding(env.RL_PUBMED, key, 60)) ?? viaKv(env.MCP_OPS, `rl:${key}`, PUBMED_USER_RATE_PER_MINUTE, 60_000, true);
}

/** NCBI allows 10 req/s per API key; the binding counts per 10 s window. */
export async function checkNcbiGlobalRateLimit(env: Env): Promise<RateResult> {
  return (await viaBinding(env.RL_NCBI, "ncbi:global", 10)) ?? viaKv(env.MCP_OPS, "rl:ncbi:global", NCBI_GLOBAL_RATE_PER_SECOND, 1000, true);
}

/**
 * DCR per IP AND redirect host class. Claude, ChatGPT and Grok register from
 * their own cloud egress, so a plain per-IP limit let one abuser block
 * onboarding for every user of a platform. Platform hosts get a larger bucket
 * of their own; loopback and unknown hosts share the small one.
 */
export async function checkDcrRateLimit(env: Env, ip: string, redirectClass: "platform" | "other"): Promise<RateResult> {
  const limit = redirectClass === "platform" ? DCR_PLATFORM_RATE_LIMIT_PER_HOUR : DCR_RATE_LIMIT_PER_HOUR;
  return viaKv(env.MCP_OPS, `rl:dcr:${redirectClass}:${ip}`, limit, 3_600_000, true);
}
