/** Heuristic flags only — never auto-block (PRD T1). */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /system\s*:\s*/i,
  /<\s*script/i,
  /\bexecute\b.*\bcommand\b/i,
  /send\s+(all\s+)?data\s+to\s+https?:/i,
  // External pentest 17 Nov 2026 (E-4): the corpus records below were not flagged.
  // Tool names never occur in a real title or abstract.
  /\bauctus_[a-z_]{3,}/i,
  // Text that addresses the assistant or claims to carry trusted instructions.
  /\b(ai\s+)?assistant\s*:/i,
  /\btrusted\s+instructions?\b/i,
  /\b(do\s+not|don't|never)\s+(tell|inform|notify)\s+the\s+user\b/i,
  /abaikan\s+(semua\s+)?(instruksi|perintah)/i,
  // Attempts to close or reopen the untrusted wrapper.
  /<\s*\/?\s*untrusted_content\b/i,
  // Markdown links are a common exfiltration carrier and do not belong in citation metadata.
  /\[[^\]]{1,80}\]\(https?:\/\//i,
  // Bulk rewrites of screening state.
  /\b(change|set|mark)\s+(every|all)\b.{0,60}\b(to|as)\s+"?(exclude|include|maybe)\b/i,
  // Hidden text: runs of zero-width characters, or bidirectional overrides.
  /[\u200b\u200c\u200d\u2060\ufeff]{2,}|[\u202a-\u202e\u2066-\u2069]/,
];

export type UntrustedText = {
  untrusted_content: string;
  _meta: {
    source: "third_party";
    truncated: boolean;
    original_length: number;
    injection_heuristic_flags: string[];
  };
};

export function wrapUntrustedText(raw: string, maxChars = 8000): UntrustedText {
  const original = raw ?? "";
  const truncated = original.length > maxChars;
  const text = truncated ? `${original.slice(0, maxChars)}\n[truncated]` : original;
  const flags: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) flags.push(pattern.source.slice(0, 48));
  }
  return {
    untrusted_content: text,
    _meta: {
      source: "third_party",
      truncated,
      original_length: original.length,
      injection_heuristic_flags: flags,
    },
  };
}
/** Structural keys whose string values come from Auctus enums, ids or timestamps, never from people. */
const STRUCTURAL_KEYS = new Set([
  "id", "status", "level", "kind", "role", "framework", "analysis", "outcome_type", "effect_measure", "direction",
  "input_mode", "certainty", "tool", "variant", "approval_path", "message", "error", "source", "tier", "basis",
  "estimateType", "year", "doi", "pmid", "pmids", "not_found", "not_on_pubmed", "files", "relation", "code", "scope",
  "scopes", "type", "pub_date_iso", "pub_date", "publication_types", "matched_by", "next_cursor", "url", "uid", "tree_numbers",
]);
const STRUCTURAL_SUFFIX = /(_id|Id|_at|_ids)$/;

/**
 * Wraps every free-text string in a tool result (pentest F4): collaborator
 * notes and reasons, project names, MA study fields and change-set payloads are
 * written by other people or other AIs and must reach the model as data.
 */
export function untrustStrings<T>(value: T, key = ""): T {
  if (typeof value === "string") {
    if (!key || STRUCTURAL_KEYS.has(key) || STRUCTURAL_SUFFIX.test(key) || value.length === 0) return value;
    return wrapUntrustedText(value, 4000) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => untrustStrings(v, key)) as unknown as T;
  if (value && typeof value === "object") {
    if ("untrusted_content" in (value as Record<string, unknown>)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = untrustStrings(v, k);
    return out as T;
  }
  return value;
}
