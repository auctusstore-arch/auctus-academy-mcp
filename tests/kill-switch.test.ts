import { describe, expect, it } from "vitest";
import { evaluateAccess } from "../src/security/kill-switch";

describe("kill switch", () => {
  it("blocks globally", () => {
    const r = evaluateAccess({ globalDisabled: true, disabledClientIds: [], pilotClientIds: [] }, "c1");
    expect(r.allowed).toBe(false);
  });

  it("enforces pilot allowlist when non-empty", () => {
    const state = { globalDisabled: false, disabledClientIds: [], pilotClientIds: ["allowed-client"] };
    expect(evaluateAccess(state, "allowed-client").allowed).toBe(true);
    expect(evaluateAccess(state, "other").allowed).toBe(false);
  });
});