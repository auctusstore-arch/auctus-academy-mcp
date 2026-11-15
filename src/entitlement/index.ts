export type ResearchAccessBasis = "complete" | "coaching_enrollment" | "coaching_assignment";

export type EntitlementResult =
  | { allowed: true; basis: ResearchAccessBasis; tier: string | null }
  | { allowed: false; reason: "free" | "no_research_access" | "mcp_not_entitled" };

export type EntitlementInput = {
  enrollmentTier: string | null;
  hasCoachingAssignment: boolean;
  mcpPilotAllowed: boolean;
};

export function resolveEntitlement(input: EntitlementInput): EntitlementResult {
  const tier = input.enrollmentTier?.toLowerCase() ?? null;
  if (tier === "free" || tier === "trial" || tier === "starter") {
    return { allowed: false, reason: "free" };
  }
  if (tier === "complete") return { allowed: true, basis: "complete", tier };
  if (tier === "coaching") return { allowed: true, basis: "coaching_enrollment", tier };
  if (input.hasCoachingAssignment) {
    return { allowed: true, basis: "coaching_assignment", tier };
  }
  if (!input.mcpPilotAllowed && input.enrollmentTier === null) {
    return { allowed: false, reason: "no_research_access" };
  }
  return { allowed: false, reason: "mcp_not_entitled" };
}

export function scopeIncludes(required: string, granted: readonly string[]): boolean {
  return granted.includes(required);
}
/** The database decides (mcp.entitlement); the Worker only reads the verdict. Fails closed. */
export function resolveEntitlementFromWhoami(
  who: { entitlement?: { allowed?: unknown; basis?: unknown; tier?: unknown } } | null | undefined,
): EntitlementResult {
  const ent = who?.entitlement;
  if (!ent || ent.allowed !== true) {
    return { allowed: false, reason: ent?.tier === "free" || ent?.tier == null ? "free" : "mcp_not_entitled" };
  }
  const basis = ent.basis;
  if (basis !== "complete" && basis !== "coaching_enrollment" && basis !== "coaching_assignment") {
    return { allowed: false, reason: "mcp_not_entitled" };
  }
  return { allowed: true, basis, tier: typeof ent.tier === "string" ? ent.tier : null };
}
