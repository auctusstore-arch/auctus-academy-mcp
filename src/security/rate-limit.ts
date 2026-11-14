import { DCR_RATE_LIMIT_PER_HOUR, READ_RATE_LIMIT_PER_MINUTE } from "../config";

type Bucket = { count: number; resetAt: number };

async function bump(kv: KVNamespace, key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const now = Date.now();
  const existing = await kv.get<{ count: number; resetAt: number }>(key, "json");
  const bucket: Bucket =
    existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  await kv.put(key, JSON.stringify(bucket), { expirationTtl: Math.ceil(windowMs / 1000) + 5 });
  if (bucket.count > limit) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export async function checkReadRateLimit(
  kv: KVNamespace,
  userId: string,
  clientId: string,
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const key = `rl:read:${userId}:${clientId}`;
  const result = await bump(kv, key, READ_RATE_LIMIT_PER_MINUTE, 60_000);
  return result;
}

export async function checkDcrRateLimit(kv: KVNamespace, ip: string): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const key = `rl:dcr:${ip}`;
  return bump(kv, key, DCR_RATE_LIMIT_PER_HOUR, 3_600_000);
}