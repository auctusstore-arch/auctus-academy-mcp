/**
 * PostgREST client that calls `mcp.*` RPCs as the signed-in user.
 *
 * Only `/rest/v1/rpc/<fn>` with `Content-Profile: mcp` is ever requested: the
 * database pre-request guard (academy migration) rejects any other path for a
 * gateway token, so this client mirrors that allowlist and fails closed here too.
 */

const RPC_NAME = /^[a-z][a-z0-9_]{1,62}$/;
const RPC_TIMEOUT_MS = 10_000;

export class SupabaseRpcError extends Error {
  constructor(
    /** Safe, model-facing code (never the raw database message). */
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "SupabaseRpcError";
  }
}

/** Maps a Postgres/PostgREST error to a code the model may see. */
export function mapRpcError(status: number, body: { code?: string; message?: string } | null): SupabaseRpcError {
  const message = body?.message ?? "";
  // mcp.* functions raise `mcp:<code>` with errcode P0001 for expected refusals.
  const match = message.match(/^mcp:([a-z_]{2,64})$/);
  if (match?.[1]) return new SupabaseRpcError(match[1], status);
  // Domain errors from ma.* and saring.* (e.g. ma_job_busy, saring_quota_exceeded) are safe, stable codes.
  if (/^(ma|saring)_[a-z_]{2,60}$/.test(message)) return new SupabaseRpcError(message, status);
  if (status === 401) return new SupabaseRpcError("unauthorized", status);
  if (status === 403 || body?.code === "42501") return new SupabaseRpcError("forbidden", status);
  if (status === 404) return new SupabaseRpcError("not_found", status);
  if (body?.code === "22P02" || body?.code === "23514" || status === 400) return new SupabaseRpcError("invalid_input", status);
  return new SupabaseRpcError("upstream_error", status >= 500 ? status : 502);
}

export type RpcCaller = <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;

export function createRpcCaller(opts: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): RpcCaller {
  const base = opts.supabaseUrl.replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (!RPC_NAME.test(fn)) throw new SupabaseRpcError("invalid_rpc", 400);
    let res: Response;
    try {
      res = await fetchImpl(`${base}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          apikey: opts.anonKey,
          Authorization: `Bearer ${opts.accessToken}`,
          "Content-Type": "application/json",
          "Content-Profile": "mcp",
          "Accept-Profile": "mcp",
          Accept: "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
    } catch {
      throw new SupabaseRpcError("upstream_unavailable", 503);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new SupabaseRpcError("upstream_error", 502);
    }
    if (!res.ok) throw mapRpcError(res.status, json as { code?: string; message?: string } | null);
    return json as T;
  };
}
