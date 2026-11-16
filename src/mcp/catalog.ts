import { createHash } from "../lib/hash";
import { TOOLS } from "./tools";

/** Public catalog: name, phase, level, scopes and annotations (no handlers). */
export const CATALOG = TOOLS.map((t) => ({
  name: t.name,
  title: t.title,
  description: t.description,
  phase: t.phase,
  level: t.level,
  scopes: t.scopes,
  ...t.annotations,
}));

export async function catalogSha256(): Promise<string> {
  return createHash(JSON.stringify(CATALOG));
}

export async function catalogWellKnownJson(): Promise<Record<string, unknown>> {
  return { version: "phase0-2", tool_prefix: "auctus_", tools: CATALOG, catalog_sha256: await catalogSha256() };
}
