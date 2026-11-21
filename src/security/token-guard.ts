import type { BeginResult } from "./auth-code-guard-core";

/** The slice of a Durable Object namespace this module needs (also easy to fake in tests). */
export interface AuthCodeGuardNamespace {
  idFromName(name: string): unknown;
  get(id: never): { begin(): Promise<BeginResult>; finish(success: boolean): Promise<void> };
}

export interface TokenGuardOptions {
  /** Undefined only in local mock mode; anywhere else a missing binding fails closed. */
  guard: AuthCodeGuardNamespace | undefined;
  mockMode: boolean;
  /** Called when an already consumed code is presented again (RFC 6749 4.1.2: revoke what the code produced). */
  revokeGrant: (grantId: string, userId: string) => Promise<void>;
}

/** Token request bodies are tiny; anything bigger is not an authorization-code exchange worth guarding. */
const MAX_TOKEN_BODY_BYTES = 16 * 1024;

const jsonError = (status: number, error: string, description: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache", ...extra },
  });

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readAuthorizationCode(request: Request): Promise<string | null> {
  if (!(request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) return null;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_TOKEN_BODY_BYTES) return null;
  const text = await request.clone().text();
  if (text.length > MAX_TOKEN_BODY_BYTES) return null;
  const params = new URLSearchParams(text);
  if (params.get("grant_type") !== "authorization_code") return null;
  return params.get("code");
}

/**
 * Wraps `POST /token`. For `grant_type=authorization_code` the exchange runs under the
 * per-code lock; every other request passes straight through. `run` performs the real
 * exchange (the OAuth library).
 */
export async function withAuthCodeGuard(request: Request, options: TokenGuardOptions, run: () => Promise<Response>): Promise<Response> {
  const code = await readAuthorizationCode(request).catch(() => null);
  if (!code) return run();
  if (!options.guard) {
    if (options.mockMode) return run();
    // The guard is what makes the code single-use; without it, do not exchange.
    return jsonError(503, "temporarily_unavailable", "token service unavailable", { "Retry-After": "30" });
  }

  let stub: ReturnType<AuthCodeGuardNamespace["get"]>;
  let begin: BeginResult;
  try {
    stub = options.guard.get(options.guard.idFromName(await sha256Hex(code)) as never);
    begin = await stub.begin();
  } catch {
    return jsonError(503, "temporarily_unavailable", "token service unavailable", { "Retry-After": "30" });
  }

  if (begin === "consumed") {
    const parts = code.split(":");
    if (parts.length === 3 && parts[0] && parts[1]) await options.revokeGrant(parts[1], parts[0]).catch(() => undefined);
    return jsonError(400, "invalid_grant", "Authorization code already used");
  }
  if (begin === "in_progress") return jsonError(400, "invalid_grant", "Authorization code is already being exchanged");

  let response: Response;
  try {
    response = await run();
  } catch (error) {
    await stub.finish(false).catch(() => undefined);
    throw error;
  }
  await stub.finish(response.status === 200).catch(() => undefined);
  return response;
}
