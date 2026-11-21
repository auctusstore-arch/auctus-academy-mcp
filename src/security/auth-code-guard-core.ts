/**
 * Single-use guard for OAuth authorization codes (pentest W-Replay).
 *
 * The OAuth library marks a code as used by deleting a field from a KV record in
 * the middle of the exchange. KV is neither atomic nor strongly consistent, so
 * two token requests that carry the same code and arrive close together can both
 * read the intact record and both receive tokens. This guard serialises the
 * exchange per code in a Durable Object.
 *
 * Two phases keep a failed attempt from burning a legitimate code:
 *   begin()  takes a short lock, or refuses if the code is consumed or locked.
 *   finish() on success marks the code consumed; on failure releases the lock.
 * Someone who only holds the code (no PKCE verifier) therefore cannot invalidate
 * the real client's exchange by guessing verifiers, except during the lock window.
 *
 * Everything here is synchronous on purpose: with a synchronous storage there is
 * no await between the read and the write, so the check-and-set is atomic without
 * relying on runtime input gates.
 */

export const LOCK_SECONDS = 30;
/** Codes live far shorter than this; state is dropped afterwards. */
export const STATE_TTL_SECONDS = 15 * 60;

export type GuardState = { status: "in_progress" | "consumed"; until: number };
export type BeginResult = "ok" | "consumed" | "in_progress";

export interface SyncGuardStorage {
  get(): GuardState | undefined;
  put(state: GuardState): void;
}

export class AuthCodeGuardCore {
  constructor(
    private readonly storage: SyncGuardStorage,
    private readonly now: () => number = () => Date.now(),
  ) {}

  begin(): BeginResult {
    const state = this.storage.get();
    const now = this.now();
    if (state?.status === "consumed") return "consumed";
    if (state?.status === "in_progress" && state.until > now) return "in_progress";
    this.storage.put({ status: "in_progress", until: now + LOCK_SECONDS * 1000 });
    return "ok";
  }

  finish(success: boolean): void {
    const state = this.storage.get();
    // Only the holder of the lock may settle it; a late finish after the lock expired and was retaken must not clobber that.
    if (state?.status !== "in_progress") return;
    if (success) this.storage.put({ status: "consumed", until: this.now() + STATE_TTL_SECONDS * 1000 });
    else this.storage.put({ status: "in_progress", until: 0 });
  }
}
