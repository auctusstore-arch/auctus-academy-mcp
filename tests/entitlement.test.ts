import { describe, expect, it } from "vitest";
import { resolveEntitlement } from "../src/entitlement";

describe("plan gate", () => {
  it("denies free tier", () => {
    const r = resolveEntitlement({ enrollmentTier: "free", hasCoachingAssignment: false, mcpPilotAllowed: true });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("free");
  });

  it("allows complete", () => {
    const r = resolveEntitlement({ enrollmentTier: "complete", hasCoachingAssignment: false, mcpPilotAllowed: true });
    expect(r.allowed).toBe(true);
  });
});