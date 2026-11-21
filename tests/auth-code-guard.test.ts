import { describe, expect, it, vi } from "vitest";
import { AuthCodeGuardCore, LOCK_SECONDS, STATE_TTL_SECONDS, type GuardState } from "../src/security/auth-code-guard-core";
import { sha256Hex, withAuthCodeGuard, type AuthCodeGuardNamespace } from "../src/security/token-guard";

function memoryCore(now: () => number = () => Date.now()) {
  let state: GuardState | undefined;
  return new AuthCodeGuardCore({ get: () => state, put: (s) => void (state = s) }, now);
}

describe("AuthCodeGuardCore", () => {
  it("allows one exchange at a time", () => {
    const core = memoryCore();
    expect(core.begin()).toBe("ok");
    expect(core.begin()).toBe("in_progress");
  });

  it("exactly one of many simultaneous begins wins", async () => {
    const core = memoryCore();
    const results = await Promise.all(Array.from({ length: 20 }, async () => core.begin()));
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "in_progress")).toHaveLength(19);
  });

  it("a successful exchange consumes the code for good", () => {
    let t = 0;
    const core = memoryCore(() => t);
    core.begin();
    core.finish(true);
    expect(core.begin()).toBe("consumed");
    t += STATE_TTL_SECONDS * 1000 * 10;
    expect(core.begin()).toBe("consumed");
  });

  it("a failed exchange releases the lock so the real client can retry", () => {
    const core = memoryCore();
    core.begin();
    core.finish(false);
    expect(core.begin()).toBe("ok");
  });

  it("an abandoned lock expires", () => {
    let t = 1_000;
    const core = memoryCore(() => t);
    expect(core.begin()).toBe("ok");
    t += (LOCK_SECONDS - 1) * 1000;
    expect(core.begin()).toBe("in_progress");
    t += 2000;
    expect(core.begin()).toBe("ok");
  });

  it("finish without a lock is a no-op", () => {
    const core = memoryCore();
    core.finish(true);
    expect(core.begin()).toBe("ok");
  });
});

/** In-memory stand-in for the namespace: one core per code hash, like the real one-DO-per-code layout. */
function fakeNamespace() {
  const cores = new Map<string, AuthCodeGuardCore>();
  const ns: AuthCodeGuardNamespace = {
    idFromName: (name) => name,
    get: ((id: string) => {
      let core = cores.get(id);
      if (!core) {
        core = memoryCore();
        cores.set(id, core);
      }
      const c = core;
      return { begin: async () => c.begin(), finish: async (ok: boolean) => c.finish(ok) };
    }) as never,
  };
  return ns;
}

const tokenRequest = (code: string, grantType = "authorization_code") =>
  new Request("https://auth.example/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: grantType, code, code_verifier: "v", client_id: "c" }),
  });

const ok = () => new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
const CODE = "user-1:grant-1:secretsecretsecret";

describe("withAuthCodeGuard", () => {
  it("lets exactly one of ten concurrent exchanges of the same code succeed", async () => {
    const guard = fakeNamespace();
    const revokeGrant = vi.fn(async () => undefined);
    const run = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return ok();
    });
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => withAuthCodeGuard(tokenRequest(CODE), { guard, mockMode: false, revokeGrant }, run)),
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 400)).toHaveLength(9);
    expect(run).toHaveBeenCalledTimes(1);
    // Rejections that happened while the first exchange was still running must not revoke the legitimate grant.
    expect(revokeGrant).not.toHaveBeenCalled();
  });

  it("refuses a replay after success and revokes the grant", async () => {
    const guard = fakeNamespace();
    const revokeGrant = vi.fn(async () => undefined);
    const options = { guard, mockMode: false, revokeGrant };
    expect((await withAuthCodeGuard(tokenRequest(CODE), options, async () => ok())).status).toBe(200);
    const replay = await withAuthCodeGuard(tokenRequest(CODE), options, async () => ok());
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    expect(revokeGrant).toHaveBeenCalledWith("grant-1", "user-1");
  });

  it("a failed exchange does not burn the code", async () => {
    const guard = fakeNamespace();
    const options = { guard, mockMode: false, revokeGrant: async () => undefined };
    const wrongVerifier = await withAuthCodeGuard(tokenRequest(CODE), options, async () => new Response("{}", { status: 400 }));
    expect(wrongVerifier.status).toBe(400);
    expect((await withAuthCodeGuard(tokenRequest(CODE), options, async () => ok())).status).toBe(200);
  });

  it("an exception in the exchange releases the lock and propagates", async () => {
    const guard = fakeNamespace();
    const options = { guard, mockMode: false, revokeGrant: async () => undefined };
    await expect(withAuthCodeGuard(tokenRequest(CODE), options, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect((await withAuthCodeGuard(tokenRequest(CODE), options, async () => ok())).status).toBe(200);
  });

  it("different codes do not interfere", async () => {
    const guard = fakeNamespace();
    const options = { guard, mockMode: false, revokeGrant: async () => undefined };
    expect((await withAuthCodeGuard(tokenRequest("u:g1:aaa"), options, async () => ok())).status).toBe(200);
    expect((await withAuthCodeGuard(tokenRequest("u:g2:bbb"), options, async () => ok())).status).toBe(200);
  });

  it("passes refresh-token requests straight through", async () => {
    const guard = { idFromName: vi.fn(), get: vi.fn() } as unknown as AuthCodeGuardNamespace;
    const run = vi.fn(async () => ok());
    const res = await withAuthCodeGuard(tokenRequest(CODE, "refresh_token"), { guard, mockMode: false, revokeGrant: async () => undefined }, run);
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect((guard as unknown as { get: ReturnType<typeof vi.fn> }).get).not.toHaveBeenCalled();
  });

  it("fails closed when the guard binding is missing outside mock mode", async () => {
    const run = vi.fn(async () => ok());
    const res = await withAuthCodeGuard(tokenRequest(CODE), { guard: undefined, mockMode: false, revokeGrant: async () => undefined }, run);
    expect(res.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs without the guard only in mock mode", async () => {
    const run = vi.fn(async () => ok());
    const res = await withAuthCodeGuard(tokenRequest(CODE), { guard: undefined, mockMode: true, revokeGrant: async () => undefined }, run);
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the guard is unreachable", async () => {
    const guard = {
      idFromName: (n: string) => n,
      get: () => ({
        begin: async () => {
          throw new Error("do unavailable");
        },
        finish: async () => undefined,
      }),
    } as unknown as AuthCodeGuardNamespace;
    const run = vi.fn(async () => ok());
    const res = await withAuthCodeGuard(tokenRequest(CODE), { guard, mockMode: false, revokeGrant: async () => undefined }, run);
    expect(res.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("hashes the code for the instance name instead of using it directly", async () => {
    const names: string[] = [];
    const guard: AuthCodeGuardNamespace = {
      idFromName: (name) => {
        names.push(name);
        return name;
      },
      get: (() => ({ begin: async () => "ok", finish: async () => undefined })) as never,
    };
    await withAuthCodeGuard(tokenRequest(CODE), { guard, mockMode: false, revokeGrant: async () => undefined }, async () => ok());
    expect(names).toEqual([await sha256Hex(CODE)]);
    expect(names[0]).not.toContain("secretsecret");
  });
});
