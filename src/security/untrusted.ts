/** Heuristic flags only — never auto-block (PRD T1). */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /system\s*:\s*/i,
  /<\s*script/i,
  /\bexecute\b.*\bcommand\b/i,
  /send\s+(all\s+)?data\s+to\s+https?:/i,
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