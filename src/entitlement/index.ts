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