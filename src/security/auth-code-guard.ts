import { DurableObject } from "cloudflare:workers";
import { AuthCodeGuardCore, STATE_TTL_SECONDS, type BeginResult, type GuardState } from "./auth-code-guard-core";

const KEY = "state";

/**
 * One instance per authorization code (named by the SHA-256 of the code), so there
 * is no shared hot spot. SQLite-backed: the synchronous `storage.kv` API keeps the
 * check-and-set atomic. See auth-code-guard-core.ts for the protocol.
 */
export class AuthCodeGuard extends DurableObject {
  private core(): AuthCodeGuardCore {
    const kv = this.ctx.storage.kv;
    return new AuthCodeGuardCore({
      get: () => kv.get<GuardState>(KEY),
      put: (state) => kv.put(KEY, state),
    });
  }

  async begin(): Promise<BeginResult> {
    const result = this.core().begin();
    if (result === "ok") await this.ctx.storage.setAlarm(Date.now() + STATE_TTL_SECONDS * 1000);
    return result;
  }

  async finish(success: boolean): Promise<void> {
    this.core().finish(success);
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
