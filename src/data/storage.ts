import { isMockMode } from "../config";
import type { ToolContext } from "./port";

const SAFE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9_./-]{1,300}$/;

/**
 * Signs one `ma-results` object for 120 s AS THE USER. Storage RLS
 * (mcp_gateway_ma_results_read) only lets a gateway token sign files under the
 * caller's own `{owner_id}/` prefix; `mcp.ma_result_file` already checked that
 * the job is done and the file is in its manifest.
 */
export async function signResultLink(ctx: ToolContext, bucket: string, path: string, expiresIn: number): Promise<string> {
  if (bucket !== "ma-results" || !SAFE_PATH.test(path) || path.includes("..")) throw new Error("not_found");
  const ttl = Math.min(Math.max(expiresIn, 30), 120);
  if (isMockMode(ctx.env)) return `https://storage.mock.invalid/ma-results/${path}?ttl=${ttl}`;
  const base = ctx.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!base || !ctx.upstreamAccessToken) throw new Error("upstream_unavailable");
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${base}/storage/v1/object/sign/${bucket}/${encoded}`, {
    method: "POST",
    headers: {
      apikey: ctx.env.SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${ctx.upstreamAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: ttl }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 400 || res.status === 403 || res.status === 404) throw new Error("not_found");
  if (!res.ok) throw new Error("upstream_unavailable");
  const json = (await res.json().catch(() => null)) as { signedURL?: unknown } | null;
  const signed = typeof json?.signedURL === "string" ? json.signedURL : null;
  if (!signed || !signed.startsWith("/")) throw new Error("upstream_unavailable");
  return `${base}/storage/v1${signed}`;
}
