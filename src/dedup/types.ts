// VENDORED from auctus-academy src/modules/citation-dedup/types.ts @ e1ebbb22 (staging). Do not edit here:
// change it in auctus-academy, then re-copy. tests/dedup-vendored.test.ts guards the copy.
// @ts-nocheck: upstream compiles without noUncheckedIndexedAccess; it is type-checked in auctus-academy.
export type CitationFormat = "ris" | "nbib";

export interface SourceReference {
  fileId: string;
  fileName: string;
  fileIndex: number;
  recordNumber: number;
  globalIndex: number;
  format: CitationFormat;
}

export interface CitationRecord {
  id: string;
  source: SourceReference;
  type: string;
  title: string;
  authors: string[];
  abstract: string;
  journal: string;
  year: string;
  doiRaw: string;
  doi: string;
  doiWasNormalized: boolean;
  urls: string[];
  volume: string;
  issue: string;
  startPage: string;
  endPage: string;
  issn: string;
  pmid: string;
  keywords: string[];
  language: string;
  publisher: string;
  identifiers: string[];
  rawTags: Record<string, string[]>;
}

export type ProcessingWarningCode =
  | "invalid-doi"
  | "ambiguous-author"
  | "author-alias-conflict"
  | "missing-fallback"
  | "ambiguous-fallback"
  | "malformed-record"
  | "metadata-conflict"
  | "file-error";

export interface ProcessingWarning {
  code: ProcessingWarningCode;
  message: string;
  source?: SourceReference;
}

export interface DuplicateGroup {
  id: string;
  method: "doi" | "fallback";
  kept: CitationRecord;
  removed: CitationRecord[];
  normalizedDoi: string;
  fallbackKey: string;
  warnings: string[];
}

export interface AuditEntry {
  id: string;
  outcome: "merged" | "not-merged";
  method: "doi" | "fallback" | "ambiguous-fallback";
  reference: SourceReference;
  related: SourceReference;
  normalizedDois: string[];
  fallbackKey: string;
  warnings: string[];
}

export interface FileProcessingSummary {
  fileId: string;
  fileIndex: number;
  fileName: string;
  format: CitationFormat;
  recordCount: number;
  status: "parsed" | "error";
  error?: string;
}

export interface DeduplicationResult {
  files: FileProcessingSummary[];
  records: CitationRecord[];
  groups: DuplicateGroup[];
  auditEntries: AuditEntry[];
  warnings: ProcessingWarning[];
  inputCount: number;
  outputCount: number;
  duplicateCount: number;
  ambiguousGroupCount: number;
  normalizedDoiCount: number;
  risText: string;
  auditCsv: string;
}

export interface CitationFileInput {
  fileId: string;
  name: string;
  text: string;
}
