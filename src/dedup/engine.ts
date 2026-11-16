// VENDORED from auctus-academy src/modules/citation-dedup/engine.ts @ e1ebbb22 (staging). Do not edit here:
// change it in auctus-academy, then re-copy. tests/dedup-vendored.test.ts guards the copy.
// @ts-nocheck: upstream compiles without noUncheckedIndexedAccess; it is type-checked in auctus-academy.
import type {
  AuditEntry,
  CitationFileInput,
  CitationFormat,
  CitationRecord,
  DeduplicationResult,
  DuplicateGroup,
  FileProcessingSummary,
  ProcessingWarning,
  SourceReference,
} from "./types";

export const MAX_CITATION_RECORDS = 10_000;

type TagMap = Record<string, string[]>;

interface ParseResult {
  records: CitationRecord[];
  warnings: ProcessingWarning[];
}

export const RIS_CANONICAL_TAGS = new Set([
  "TY",
  "ER",
  "TI",
  "T1",
  "CT",
  "AU",
  "A1",
  "AB",
  "N2",
  "JO",
  "JF",
  "T2",
  "JA",
  "PY",
  "Y1",
  "DA",
  "DO",
  "UR",
  "L1",
  "L2",
  "VL",
  "IS",
  "SP",
  "EP",
  "SN",
  "KW",
  "LA",
  "PB",
  "AN",
]);

function cleanText(value: string | undefined): string {
  return (value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAuthor(value: string | undefined): string {
  return cleanText(value).replace(/^=\s*/, "");
}

function first(tags: TagMap, names: string[]): string {
  for (const name of names) {
    const value = tags[name]?.find((entry) => cleanText(entry));
    if (value) return cleanText(value);
  }
  return "";
}

function all(tags: TagMap, names: string[]): string[] {
  return names.flatMap((name) => tags[name] ?? []).map(cleanText).filter(Boolean);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(cleanText).filter(Boolean)) {
    const key = value.toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function uniqueAuthors(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(cleanAuthor).filter(Boolean)) {
    const key = value.normalize("NFKC").toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function extractYear(value: string): string {
  return value.match(/\b(?:18|19|20|21)\d{2}\b/)?.[0] ?? "";
}

function splitPages(value: string): { startPage: string; endPage: string } {
  const cleaned = cleanText(value);
  if (!cleaned) return { startPage: "", endPage: "" };
  const separator = cleaned.match(/^(.+?)[-–](.+)$/);
  if (!separator) return { startPage: cleaned, endPage: "" };
  return { startPage: cleanText(separator[1]), endPage: cleanText(separator[2]) };
}

const DOI_PATTERN = /^10\.\d{4,9}\/[^\s\u0000-\u001F\u007F]+$/i;

function unwrapPairedValue(value: string): string {
  const pairs: Array<[string, string]> = [
    ["<", ">"],
    ['"', '"'],
    ["'", "'"],
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ];
  let result = value.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [opening, closing] of pairs) {
      if (result.startsWith(opening) && result.endsWith(closing)) {
        result = result.slice(opening.length, -closing.length).trim();
        changed = true;
        break;
      }
    }
  }
  return result;
}

function decodeUrlPath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function doiCandidateFromUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!/^(?:dx\.)?doi\.org$/i.test(url.hostname)) return "";
    return decodeUrlPath(url.pathname).replace(/^\/+/, "");
  } catch {
    return "";
  }
}

export function normalizeDoi(value: string): string {
  let candidate = value
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/\s*\[doi\]\s*$/i, "")
    .replace(/^doi\s*:\s*/i, "")
    .trim();

  candidate = unwrapPairedValue(candidate);
  const urlCandidate = /^https?:\/\//i.test(candidate)
    ? doiCandidateFromUrl(candidate)
    : "";
  if (urlCandidate) candidate = urlCandidate;
  else if (/^(?:dx\.)?doi\.org\//i.test(candidate)) {
    candidate = candidate
      .replace(/^(?:dx\.)?doi\.org\//i, "")
      .split(/[?#]/, 1)[0];
  }
  else if (!/^10\./i.test(candidate)) candidate = "";

  candidate = unwrapPairedValue(candidate).toLowerCase();
  return DOI_PATTERN.test(candidate) ? candidate : "";
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      const isUnicodeScalar =
        Number.isInteger(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff &&
        (codePoint < 0xd800 || codePoint > 0xdfff);
      return isUnicodeScalar ? String.fromCodePoint(codePoint) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

export function normalizeMatchText(value: string): string {
  return decodeHtmlEntities(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

interface AuthorSurnameResult {
  surname: string;
  confidence: "reliable" | "ambiguous" | "missing";
  reason:
    | "comma-separated"
    | "single-token"
    | "trailing-initial"
    | "leading-initial"
    | "both-ends-initial-like"
    | "unstructured-name"
    | "missing-author";
}

function isInitialToken(value: string): boolean {
  const compact = value.replace(/[.\-]/g, "");
  return (
    compact.length > 0 &&
    compact.length <= 4 &&
    /^\p{Lu}+$/u.test(compact)
  );
}

function firstAuthorSurname(record: CitationRecord): AuthorSurnameResult {
  const author = cleanText(record.authors[0]);
  if (!author) {
    return { surname: "", confidence: "missing", reason: "missing-author" };
  }
  if (author.includes(",")) {
    const surname = normalizeMatchText(author.split(",", 1)[0]);
    return {
      surname,
      confidence: surname ? "reliable" : "missing",
      reason: surname ? "comma-separated" : "missing-author",
    };
  }
  const pieces = author.split(/\s+/).filter(Boolean);
  if (pieces.length === 1) {
    return {
      surname: normalizeMatchText(pieces[0]),
      confidence: "reliable",
      reason: "single-token",
    };
  }
  const firstLooksLikeInitial = isInitialToken(pieces[0]);
  const lastLooksLikeInitial = isInitialToken(pieces.at(-1) ?? "");
  if (firstLooksLikeInitial && lastLooksLikeInitial) {
    return {
      surname: "",
      confidence: "ambiguous",
      reason: "both-ends-initial-like",
    };
  }
  if (lastLooksLikeInitial) {
    return {
      surname: normalizeMatchText(pieces.slice(0, -1).join(" ")),
      confidence: "reliable",
      reason: "trailing-initial",
    };
  }
  if (firstLooksLikeInitial) {
    return {
      surname: normalizeMatchText(pieces.slice(1).join(" ")),
      confidence: "reliable",
      reason: "leading-initial",
    };
  }
  return {
    surname: "",
    confidence: "ambiguous",
    reason: "unstructured-name",
  };
}

export function buildFallbackKey(record: CitationRecord): string {
  const { surname } = firstAuthorSurname(record);
  const title = normalizeMatchText(record.title);
  const year = extractYear(record.year);
  return surname && title && year ? `${surname}\u241f${title}\u241f${year}` : "";
}

function sourceFor(
  fileName: string,
  fileId: string,
  fileIndex: number,
  recordNumber: number,
  globalIndex: number,
  format: CitationFormat
): SourceReference {
  return { fileId, fileName, fileIndex, recordNumber, globalIndex, format };
}

function looksLikeDeclaredDoi(value: string): boolean {
  const candidate = unwrapPairedValue(cleanText(value));
  return (
    /^10\./i.test(candidate) ||
    /^doi\s*:/i.test(candidate) ||
    /\[doi\]\s*$/i.test(candidate)
  );
}

interface DoiSearchResult {
  raw: string;
  normalized: string;
  invalidRaw: string[];
}

function findDoi(
  tags: TagMap,
  preferredTags: string[],
  preserveInvalid: (value: string) => boolean = () => true
): DoiSearchResult {
  const candidates = all(tags, preferredTags);
  const invalidRaw: string[] = [];
  let selectedRaw = "";
  let selectedNormalized = "";
  for (const raw of candidates) {
    const normalized = normalizeDoi(raw);
    if (normalized && !selectedNormalized) {
      selectedRaw = raw;
      selectedNormalized = normalized;
    } else if (!normalized && preserveInvalid(raw)) {
      invalidRaw.push(raw);
    }
  }
  return {
    raw: selectedRaw || invalidRaw[0] || "",
    normalized: selectedNormalized,
    invalidRaw,
  };
}

function findRisDoi(tags: TagMap): DoiSearchResult {
  const explicit = findDoi(tags, ["DO"]);
  if (explicit.normalized) return explicit;

  const discovered = findDoi(tags, ["UR", "M3", "N1"], () => false);
  if (!discovered.normalized) return explicit;
  return {
    ...discovered,
    invalidRaw: explicit.invalidRaw,
  };
}

interface ResolvedRisAuthors {
  authors: string[];
  selectedTag: "AU" | "A1" | "";
  conflict: boolean;
}

function resolveRisAuthors(tags: TagMap): ResolvedRisAuthors {
  const candidates = (["AU", "A1"] as const)
    .map((tag, priority) => ({
      tag,
      priority,
      authors: uniqueAuthors(tags[tag] ?? []),
    }))
    .filter((candidate) => candidate.authors.length > 0)
    .sort(
      (a, b) =>
        compareAuthorLists(a.authors, b.authors) ||
        a.priority - b.priority
    );
  if (candidates.length === 0) {
    return { authors: [], selectedTag: "", conflict: false };
  }
  const fingerprints = new Set(
    candidates.map((candidate) => authorListFingerprint(candidate.authors))
  );
  return {
    authors: candidates[0].authors,
    selectedTag: candidates[0].tag,
    conflict: fingerprints.size > 1,
  };
}

function canonicalRisRecord(
  tags: TagMap,
  source: SourceReference
): { record: CitationRecord; warnings: ProcessingWarning[] } {
  const doiResult = findRisDoi(tags);
  const resolvedAuthors = resolveRisAuthors(tags);
  const record: CitationRecord = {
    id: `${source.fileId}:${source.recordNumber}`,
    source,
    type: first(tags, ["TY"]) || "JOUR",
    title: first(tags, ["TI", "T1", "CT"]),
    authors: resolvedAuthors.authors,
    abstract: first(tags, ["AB", "N2"]),
    journal: first(tags, ["JO", "JF", "T2", "JA"]),
    year: extractYear(first(tags, ["PY", "Y1", "DA"])),
    doiRaw: doiResult.raw,
    doi: doiResult.normalized,
    doiWasNormalized: Boolean(
      doiResult.normalized && cleanText(doiResult.raw).toLowerCase() !== doiResult.normalized
    ),
    urls: unique(all(tags, ["UR", "L1", "L2"])),
    volume: first(tags, ["VL"]),
    issue: first(tags, ["IS"]),
    startPage: first(tags, ["SP"]),
    endPage: first(tags, ["EP"]),
    issn: first(tags, ["SN"]),
    pmid: "",
    keywords: unique(all(tags, ["KW"])),
    language: first(tags, ["LA"]),
    publisher: first(tags, ["PB"]),
    identifiers: unique([
      ...all(tags, ["AN"]),
      ...doiResult.invalidRaw.map(
        (raw) => `DOI asli tidak tervalidasi: ${raw}`
      ),
    ]),
    rawTags: tags,
  };
  const warnings: ProcessingWarning[] = resolvedAuthors.conflict
    ? [{
        code: "author-alias-conflict",
        message: `Daftar AU dan A1 berbeda pada ${source.fileName}, record ${source.recordNumber}; ${resolvedAuthors.selectedTag} dipilih.`,
        source,
      }]
    : [];
  return { record, warnings };
}

function canonicalNbibRecord(tags: TagMap, source: SourceReference): CitationRecord {
  const doiResult = findDoi(tags, ["AID", "LID"], looksLikeDeclaredDoi);
  const pages = splitPages(first(tags, ["PG"]));
  const fullAuthors = all(tags, ["FAU"]);
  const identifiers = all(tags, ["AID", "LID"]).filter((value) =>
    doiResult.normalized
      ? normalizeDoi(value) !== doiResult.normalized
      : true
  );
  const publicationTypes = all(tags, ["PT"]);
  return {
    id: `${source.fileId}:${source.recordNumber}`,
    source,
    type: publicationTypes.some((value) => /journal article/i.test(value)) ? "JOUR" : "JOUR",
    title: first(tags, ["TI", "BTI"]),
    authors: uniqueAuthors(fullAuthors.length > 0 ? fullAuthors : all(tags, ["AU", "CN"])),
    abstract: first(tags, ["AB"]),
    journal: first(tags, ["JT", "TA"]),
    year: extractYear(first(tags, ["DP", "DEP"])),
    doiRaw: doiResult.raw,
    doi: doiResult.normalized,
    doiWasNormalized: Boolean(
      doiResult.normalized && cleanText(doiResult.raw).toLowerCase() !== doiResult.normalized
    ),
    urls: [],
    volume: first(tags, ["VI"]),
    issue: first(tags, ["IP"]),
    startPage: pages.startPage,
    endPage: pages.endPage,
    issn: first(tags, ["IS"]).replace(/\s*\([^)]*\)\s*$/, ""),
    pmid: first(tags, ["PMID"]),
    keywords: unique(all(tags, ["OT", "MH"])),
    language: first(tags, ["LA"]),
    publisher: "",
    identifiers: unique(identifiers),
    rawTags: {},
  };
}

function pushTag(tags: TagMap, tag: string, value: string): void {
  const cleaned = cleanText(value);
  if (!tags[tag]) tags[tag] = [];
  tags[tag].push(cleaned);
}

function appendContinuation(tags: TagMap, lastTag: string, value: string): void {
  const entries = tags[lastTag];
  if (!entries?.length) return;
  const index = entries.length - 1;
  entries[index] = cleanText(`${entries[index]} ${value}`);
}

export function parseRis(
  text: string,
  fileName = "references.ris",
  fileIndex = 0,
  globalStartIndex = 0,
  fileId = `fixture:${fileIndex}:${fileName}`
): ParseResult {
  const records: CitationRecord[] = [];
  const warnings: ProcessingWarning[] = [];
  let current: TagMap | null = null;
  let lastTag = "";
  let recordNumber = 0;

  const finish = (missingEnd = false) => {
    if (!current) return;
    recordNumber += 1;
    const source = sourceFor(
      fileName,
      fileId,
      fileIndex,
      recordNumber,
      globalStartIndex + records.length,
      "ris"
    );
    const canonical = canonicalRisRecord(current, source);
    const record = canonical.record;
    records.push(record);
    warnings.push(...canonical.warnings);
    if (missingEnd) {
      warnings.push({
        code: "malformed-record",
        message: `Record ${recordNumber} tidak memiliki tag ER dan tetap diproses.`,
        source,
      });
    }
    current = null;
    lastTag = "";
  };

  for (const rawLine of text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")) {
    const match = rawLine.match(/^([A-Z0-9]{2})\s*-\s?(.*)$/);
    if (!match) {
      if (current && lastTag && rawLine.trim()) appendContinuation(current, lastTag, rawLine);
      continue;
    }
    const [, tag, value] = match;
    if (tag === "TY") {
      if (current) finish(true);
      current = {};
    }
    if (!current) continue;
    if (tag === "ER") {
      finish(false);
      continue;
    }
    pushTag(current, tag, value);
    lastTag = tag;
  }
  if (current) finish(true);

  return { records, warnings };
}

export function parseNbib(
  text: string,
  fileName = "references.nbib",
  fileIndex = 0,
  globalStartIndex = 0,
  fileId = `fixture:${fileIndex}:${fileName}`
): ParseResult {
  const records: CitationRecord[] = [];
  const warnings: ProcessingWarning[] = [];
  let current: TagMap = {};
  let lastTag = "";
  let recordNumber = 0;

  const finish = () => {
    if (Object.keys(current).length === 0) return;
    recordNumber += 1;
    const source = sourceFor(
      fileName,
      fileId,
      fileIndex,
      recordNumber,
      globalStartIndex + records.length,
      "nbib"
    );
    records.push(canonicalNbibRecord(current, source));
    current = {};
    lastTag = "";
  };

  for (const rawLine of text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")) {
    if (!rawLine.trim()) {
      finish();
      continue;
    }
    const match = rawLine.match(/^([A-Z0-9]{2,4})\s*-\s?(.*)$/);
    if (match) {
      const [, tag, value] = match;
      pushTag(current, tag, value);
      lastTag = tag;
    } else if (lastTag) {
      appendContinuation(current, lastTag, rawLine);
    }
  }
  finish();
  return { records, warnings };
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  add(value: string): void {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: string): string {
    const parent = this.parent.get(value);
    if (!parent || parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

const SCALAR_FIELDS = [
  "title",
  "journal",
  "year",
  "volume",
  "issue",
  "startPage",
  "endPage",
  "issn",
  "pmid",
  "language",
  "publisher",
] as const;

function completeness(record: CitationRecord): number {
  const scalarCount = SCALAR_FIELDS.filter((field) => cleanText(record[field])).length;
  return (
    scalarCount +
    Number(Boolean(record.abstract)) +
    Number(Boolean(record.doi)) +
    Number(record.authors.length > 0) +
    Number(record.urls.length > 0) +
    Number(record.keywords.length > 0) +
    Number(record.identifiers.length > 0)
  );
}

function contentLength(record: CitationRecord): number {
  return [
    ...SCALAR_FIELDS.map((field) => record[field]),
    record.abstract,
    record.doi,
    ...record.authors,
    ...record.urls,
    ...record.keywords,
    ...record.identifiers,
  ].join("").length;
}

function cloneRecord(record: CitationRecord): CitationRecord {
  return {
    ...record,
    source: { ...record.source },
    authors: [...record.authors],
    urls: [...record.urls],
    keywords: [...record.keywords],
    identifiers: [...record.identifiers],
    rawTags: Object.fromEntries(
      Object.entries(record.rawTags).map(([tag, values]) => [tag, [...values]])
    ),
  };
}

function choosePrimary(records: CitationRecord[]): CitationRecord {
  return [...records].sort((a, b) => {
    return (
      completeness(b) - completeness(a) ||
      Number(Boolean(b.abstract)) - Number(Boolean(a.abstract)) ||
      contentLength(b) - contentLength(a) ||
      a.source.globalIndex - b.source.globalIndex
    );
  })[0];
}

function authorListFingerprint(authors: string[]): string {
  return uniqueAuthors(authors)
    .map((author) => cleanText(author).normalize("NFKC").toLocaleLowerCase("en"))
    .join("\u241f");
}

function authorListDetailScore(authors: string[]): number {
  return authors.reduce((score, author) => {
    const commaParts = author.split(",", 2);
    const pieces = author.split(/\s+/).filter(Boolean);
    const givenNameTokens = commaParts.length > 1
      ? commaParts[1].split(/\s+/)
      : isInitialToken(pieces.at(-1) ?? "")
        ? [pieces.at(-1) ?? ""]
        : isInitialToken(pieces[0] ?? "")
          ? [pieces[0]]
          : pieces.slice(0, -1);
    const detailedTokens = givenNameTokens
      .map((token) => token.replace(/[^\p{L}]/gu, ""))
      .filter((token) => token.length > 1 && !isInitialToken(token));
    return score + detailedTokens.length;
  }, 0);
}

function compareAuthorLists(a: string[], b: string[]): number {
  const authorsA = uniqueAuthors(a);
  const authorsB = uniqueAuthors(b);
  return (
    authorsB.length - authorsA.length ||
    authorListDetailScore(authorsB) - authorListDetailScore(authorsA) ||
    authorsB.join("").length - authorsA.join("").length
  );
}

function chooseAuthorRecord(
  records: CitationRecord[],
  primary: CitationRecord
): CitationRecord {
  return [...records].sort((a, b) => {
    return (
      compareAuthorLists(a.authors, b.authors) ||
      Number(b.id === primary.id) - Number(a.id === primary.id) ||
      a.source.globalIndex - b.source.globalIndex
    );
  })[0];
}

function mergeRecords(records: CitationRecord[]): { record: CitationRecord; warnings: string[] } {
  const primary = choosePrimary(records);
  const authorRecord = chooseAuthorRecord(records, primary);
  const merged = cloneRecord(primary);
  const recordsWithDoi = records.filter((record) => record.doi);
  const distinctDois = new Set(recordsWithDoi.map((record) => record.doi));
  if (distinctDois.size === 1) {
    const canonicalDoi = [...distinctDois][0];
    const doiSource = primary.doi === canonicalDoi
      ? primary
      : [...recordsWithDoi].sort(
          (a, b) => a.source.globalIndex - b.source.globalIndex
        )[0];
    merged.doi = canonicalDoi;
    merged.doiRaw = doiSource.doiRaw;
    merged.doiWasNormalized = doiSource.doiWasNormalized;
  }
  merged.authors = uniqueAuthors(authorRecord.authors);
  const conflicts = new Set<string>();
  const warnings: string[] = [];
  const authorFingerprints = new Set(
    records
      .filter((record) => record.authors.length > 0)
      .map((record) => authorListFingerprint(record.authors))
  );
  if (authorFingerprints.size > 1) {
    warnings.push(
      `Daftar author berbeda; ${authorRecord.source.fileName} record ${authorRecord.source.recordNumber} dipilih.`
    );
  }

  for (const record of records) {
    if (record.id === primary.id) continue;
    if (record.abstract.length > merged.abstract.length) merged.abstract = record.abstract;
    merged.urls = unique([...merged.urls, ...record.urls]);
    merged.keywords = unique([...merged.keywords, ...record.keywords]);
    merged.identifiers = unique([...merged.identifiers, ...record.identifiers]);

    for (const field of SCALAR_FIELDS) {
      if (!merged[field] && record[field]) {
        merged[field] = record[field];
      } else if (
        merged[field] &&
        record[field] &&
        normalizeMatchText(merged[field]) !== normalizeMatchText(record[field])
      ) {
        conflicts.add(field);
      }
    }

    for (const [tag, values] of Object.entries(record.rawTags)) {
      if (RIS_CANONICAL_TAGS.has(tag)) continue;
      if (!merged.rawTags[tag]) merged.rawTags[tag] = [...values];
    }
  }

  return {
    record: merged,
    warnings: [
      ...warnings,
      ...[...conflicts].map(
        (field) => `Konflik metadata pada field ${field}; record utama dipakai.`
      ),
    ],
  };
}

interface DeduplicatedRecordsResult {
  records: CitationRecord[];
  groups: DuplicateGroup[];
  auditEntries: AuditEntry[];
  ambiguousGroupCount: number;
  warnings: ProcessingWarning[];
}

export class DeduplicationInvariantError extends Error {
  constructor(message: string) {
    super(`Invariant deduplikasi gagal: ${message}`);
    this.name = "DeduplicationInvariantError";
  }
}

function sourceRecordKey(source: SourceReference): string {
  return `${source.fileId}:${source.recordNumber}`;
}

function assertUniqueInputRecords(records: CitationRecord[]): void {
  const ids = new Set<string>();
  const sources = new Set<string>();
  for (const record of records) {
    const sourceKey = sourceRecordKey(record.source);
    if (ids.has(record.id)) {
      throw new DeduplicationInvariantError(`record ID tidak unik: ${record.id}.`);
    }
    if (sources.has(sourceKey)) {
      throw new DeduplicationInvariantError(`referensi sumber tidak unik: ${sourceKey}.`);
    }
    ids.add(record.id);
    sources.add(sourceKey);
  }
}

export function assertDeduplicationInvariants(
  input: CitationRecord[],
  result: DeduplicatedRecordsResult
): void {
  assertUniqueInputRecords(input);
  const inputIds = new Set(input.map((record) => record.id));
  const outputIds = new Set(result.records.map((record) => record.id));
  const removed = result.groups.flatMap((group) => group.removed);
  const removedIds = new Set(removed.map((record) => record.id));

  if (outputIds.size !== result.records.length) {
    throw new DeduplicationInvariantError("record output tidak unik.");
  }
  if (removedIds.size !== removed.length) {
    throw new DeduplicationInvariantError("record dibuang lebih dari sekali.");
  }
  if (result.records.length + removed.length !== input.length) {
    throw new DeduplicationInvariantError("jumlah output dan record dibuang tidak sesuai input.");
  }
  for (const id of outputIds) {
    if (removedIds.has(id)) {
      throw new DeduplicationInvariantError(`record ${id} menjadi output sekaligus dibuang.`);
    }
  }
  const accountedIds = new Set([...outputIds, ...removedIds]);
  if (
    accountedIds.size !== inputIds.size ||
    [...inputIds].some((id) => !accountedIds.has(id))
  ) {
    throw new DeduplicationInvariantError("tidak semua record input dapat dipertanggungjawabkan.");
  }

  const outputDois = result.records.map((record) => record.doi).filter(Boolean);
  if (new Set(outputDois).size !== outputDois.length) {
    throw new DeduplicationInvariantError("DOI canonical berulang pada output.");
  }

  for (const group of result.groups) {
    const dois = new Set(
      [group.kept, ...group.removed].map((record) => record.doi).filter(Boolean)
    );
    if (dois.size > 1) {
      throw new DeduplicationInvariantError(`grup ${group.id} memuat DOI valid berbeda.`);
    }
    const expectedDoi = [...dois][0] ?? "";
    if (group.kept.doi !== expectedDoi || group.normalizedDoi !== expectedDoi) {
      throw new DeduplicationInvariantError(
        `grup ${group.id} tidak mempertahankan DOI canonical.`
      );
    }
    const groupAudits = result.auditEntries.filter(
      (entry) => entry.id === group.id && entry.outcome === "merged"
    );
    const expectedRelated = new Set(group.removed.map((record) => sourceRecordKey(record.source)));
    const auditedRelated = new Set(groupAudits.map((entry) => sourceRecordKey(entry.related)));
    if (
      groupAudits.length !== group.removed.length ||
      auditedRelated.size !== expectedRelated.size ||
      [...expectedRelated].some((source) => !auditedRelated.has(source))
    ) {
      throw new DeduplicationInvariantError(`audit merged untuk ${group.id} tidak lengkap.`);
    }
    if (
      groupAudits.some(
        (entry) => sourceRecordKey(entry.reference) !== sourceRecordKey(group.kept.source)
      )
    ) {
      throw new DeduplicationInvariantError(`referensi audit ${group.id} tidak sesuai record utama.`);
    }
  }

  const mergedAuditEntries = result.auditEntries.filter((entry) => entry.outcome === "merged");
  if (mergedAuditEntries.length !== removed.length) {
    throw new DeduplicationInvariantError("jumlah audit merged tidak sesuai record dibuang.");
  }
  const inputSources = new Set(input.map((record) => sourceRecordKey(record.source)));
  for (const entry of result.auditEntries.filter((audit) => audit.outcome === "not-merged")) {
    if (
      entry.method !== "ambiguous-fallback" ||
      !inputSources.has(sourceRecordKey(entry.reference)) ||
      !inputSources.has(sourceRecordKey(entry.related)) ||
      new Set(entry.normalizedDois).size < 2
    ) {
      throw new DeduplicationInvariantError(`audit not-merged ${entry.id} tidak konsisten.`);
    }
  }

  for (const record of result.records) {
    const nonEmptyAuthors = record.authors.map(cleanText).filter(Boolean);
    if (uniqueAuthors(nonEmptyAuthors).length !== nonEmptyAuthors.length) {
      throw new DeduplicationInvariantError(`author berulang pada record ${record.id}.`);
    }
  }
}

export function deduplicateRecords(records: CitationRecord[]): DeduplicatedRecordsResult {
  assertUniqueInputRecords(records);
  const dsu = new DisjointSet();
  const byDoi = new Map<string, CitationRecord[]>();
  const byFallback = new Map<string, CitationRecord[]>();
  const warnings: ProcessingWarning[] = [];
  const auditEntries: AuditEntry[] = [];
  let ambiguousGroupCount = 0;

  for (const record of records) {
    dsu.add(record.id);
    if (record.doi) {
      const doiRecords = byDoi.get(record.doi) ?? [];
      doiRecords.push(record);
      byDoi.set(record.doi, doiRecords);
    } else if (record.doiRaw) {
      warnings.push({
        code: "invalid-doi",
        message: `DOI tidak valid pada ${record.source.fileName}, record ${record.source.recordNumber}.`,
        source: record.source,
      });
    }

    const fallbackKey = buildFallbackKey(record);
    if (fallbackKey) {
      const fallbackRecords = byFallback.get(fallbackKey) ?? [];
      fallbackRecords.push(record);
      byFallback.set(fallbackKey, fallbackRecords);
    } else {
      const authorSurname = firstAuthorSurname(record);
      warnings.push({
        code: authorSurname.confidence === "ambiguous"
          ? "ambiguous-author"
          : "missing-fallback",
        message: authorSurname.confidence === "ambiguous"
          ? `Format author ambigu pada ${record.source.fileName}, record ${record.source.recordNumber}; fallback tidak digunakan.`
          : `Author, judul, atau tahun tidak lengkap pada ${record.source.fileName}, record ${record.source.recordNumber}.`,
        source: record.source,
      });
    }
  }

  for (const doiRecords of byDoi.values()) {
    for (let index = 1; index < doiRecords.length; index += 1) {
      dsu.union(doiRecords[0].id, doiRecords[index].id);
    }
  }

  for (const [fallbackKey, fallbackRecords] of byFallback.entries()) {
    if (fallbackRecords.length < 2) continue;
    const dois = new Set(fallbackRecords.map((record) => record.doi).filter(Boolean));
    if (dois.size > 1) {
      const sortedRecords = [...fallbackRecords].sort(
        (a, b) => a.source.globalIndex - b.source.globalIndex
      );
      ambiguousGroupCount += 1;
      const auditId = `ambiguous-${ambiguousGroupCount}`;
      const warning = `Fallback key cocok dengan beberapa DOI berbeda dan tidak digabung: ${fallbackKey}.`;
      warnings.push({
        code: "ambiguous-fallback",
        message: warning,
      });
      for (const related of sortedRecords.slice(1)) {
        auditEntries.push({
          id: auditId,
          outcome: "not-merged",
          method: "ambiguous-fallback",
          reference: sortedRecords[0].source,
          related: related.source,
          normalizedDois: unique(sortedRecords.map((record) => record.doi)),
          fallbackKey,
          warnings: [warning],
        });
      }
      continue;
    }
    for (let index = 1; index < fallbackRecords.length; index += 1) {
      dsu.union(fallbackRecords[0].id, fallbackRecords[index].id);
    }
  }

  const grouped = new Map<string, CitationRecord[]>();
  for (const record of records) {
    const root = dsu.find(record.id);
    const group = grouped.get(root) ?? [];
    group.push(record);
    grouped.set(root, group);
  }

  const output: CitationRecord[] = [];
  const duplicateGroups: DuplicateGroup[] = [];
  const sortedGroups = [...grouped.values()].sort(
    (a, b) => a[0].source.globalIndex - b[0].source.globalIndex
  );

  for (const groupRecords of sortedGroups) {
    if (groupRecords.length === 1) {
      output.push(groupRecords[0]);
      continue;
    }
    const merged = mergeRecords(groupRecords);
    const removed = groupRecords
      .filter((record) => record.id !== merged.record.id)
      .sort((a, b) => a.source.globalIndex - b.source.globalIndex);
    const distinctDois = new Set(groupRecords.map((record) => record.doi).filter(Boolean));
    const fallbackKey = buildFallbackKey(merged.record);
    const method = distinctDois.size === 1 && groupRecords.every((record) => record.doi)
      ? "doi"
      : "fallback";

    output.push(merged.record);
    const groupId = `group-${duplicateGroups.length + 1}`;
    duplicateGroups.push({
      id: groupId,
      method,
      kept: merged.record,
      removed,
      normalizedDoi: merged.record.doi,
      fallbackKey,
      warnings: merged.warnings,
    });
    for (const related of removed) {
      auditEntries.push({
        id: groupId,
        outcome: "merged",
        method,
        reference: merged.record.source,
        related: related.source,
        normalizedDois: unique(groupRecords.map((record) => record.doi)),
        fallbackKey,
        warnings: merged.warnings,
      });
    }
  }

  output.sort((a, b) => a.source.globalIndex - b.source.globalIndex);
  auditEntries.sort(
    (a, b) =>
      a.reference.globalIndex - b.reference.globalIndex ||
      a.related.globalIndex - b.related.globalIndex
  );
  const result: DeduplicatedRecordsResult = {
    records: output,
    groups: duplicateGroups,
    auditEntries,
    ambiguousGroupCount,
    warnings,
  };
  assertDeduplicationInvariants(records, result);
  return result;
}

function sanitizeRisValue(value: string): string[] {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function risLines(tag: string, value: string): string[] {
  const parts = sanitizeRisValue(value);
  if (parts.length === 0) return [];
  return [`${tag}  - ${parts[0]}`, ...parts.slice(1).map((part) => `      ${part}`)];
}

export function serializeRis(records: CitationRecord[]): string {
  const entries = records.map((record) => {
    const lines: string[] = [`TY  - ${record.type || "JOUR"}`];
    for (const author of uniqueAuthors(record.authors)) lines.push(...risLines("AU", author));
    lines.push(...risLines("TI", record.title));
    lines.push(...risLines("PY", record.year));
    lines.push(...risLines("JO", record.journal));
    lines.push(...risLines("VL", record.volume));
    lines.push(...risLines("IS", record.issue));
    lines.push(...risLines("SP", record.startPage));
    lines.push(...risLines("EP", record.endPage));
    lines.push(...risLines("SN", record.issn));
    lines.push(...risLines("DO", record.doi));
    for (const url of record.urls) lines.push(...risLines("UR", url));
    lines.push(...risLines("AB", record.abstract));
    for (const keyword of record.keywords) lines.push(...risLines("KW", keyword));
    lines.push(...risLines("LA", record.language));
    lines.push(...risLines("PB", record.publisher));
    if (record.pmid) lines.push(...risLines("AN", `PMID:${record.pmid}`));
    for (const identifier of record.identifiers) lines.push(...risLines("AN", identifier));

    for (const [tag, values] of Object.entries(record.rawTags)) {
      if (RIS_CANONICAL_TAGS.has(tag) || !/^[A-Z0-9]{2}$/.test(tag)) continue;
      for (const value of values) lines.push(...risLines(tag, value));
    }
    lines.push("ER  -");
    return lines.join("\r\n");
  });
  return entries.length > 0 ? `${entries.join("\r\n\r\n")}\r\n` : "";
}

function csvCell(value: string | number): string {
  const raw = String(value);
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeAuditCsv(entries: AuditEntry[]): string {
  const header = [
    "audit_id",
    "outcome",
    "match_method",
    "reference_source_file",
    "reference_file_id",
    "reference_file_number",
    "reference_record_number",
    "related_source_file",
    "related_file_id",
    "related_file_number",
    "related_record_number",
    "normalized_dois",
    "fallback_key",
    "warning",
  ];
  const rows = entries.map((entry) => [
    entry.id,
    entry.outcome,
    entry.method,
    entry.reference.fileName,
    entry.reference.fileId,
    entry.reference.fileIndex + 1,
    entry.reference.recordNumber,
    entry.related.fileName,
    entry.related.fileId,
    entry.related.fileIndex + 1,
    entry.related.recordNumber,
    entry.normalizedDois.join(" | "),
    entry.fallbackKey,
    entry.warnings.join(" | "),
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function formatFromFileName(fileName: string): CitationFormat {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "ris" || extension === "nbib") return extension;
  throw new Error("Format file harus .ris atau .nbib.");
}

export function processCitationFiles(
  files: CitationFileInput[],
  onProgress?: (progress: number) => void
): DeduplicationResult {
  const fileIds = new Set<string>();
  for (const file of files) {
    if (!file.fileId.trim()) {
      throw new DeduplicationInvariantError("fileId wajib diisi.");
    }
    if (fileIds.has(file.fileId)) {
      throw new DeduplicationInvariantError(`fileId tidak unik: ${file.fileId}.`);
    }
    fileIds.add(file.fileId);
  }

  const records: CitationRecord[] = [];
  const warnings: ProcessingWarning[] = [];
  const summaries: FileProcessingSummary[] = [];

  files.forEach((file, fileIndex) => {
    try {
      const format = formatFromFileName(file.name);
      const parsed = format === "ris"
        ? parseRis(file.text, file.name, fileIndex, records.length, file.fileId)
        : parseNbib(file.text, file.name, fileIndex, records.length, file.fileId);
      if (parsed.records.length === 0) throw new Error("Tidak ada record yang dapat dibaca.");
      records.push(...parsed.records);
      warnings.push(...parsed.warnings);
      summaries.push({
        fileId: file.fileId,
        fileIndex,
        fileName: file.name,
        format,
        recordCount: parsed.records.length,
        status: "parsed",
      });
    } catch (error) {
      let format: CitationFormat = "ris";
      try {
        format = formatFromFileName(file.name);
      } catch {
        // UI filters unsupported extensions, but keep a safe summary for direct callers.
      }
      const message = error instanceof Error ? error.message : "File tidak dapat diproses.";
      summaries.push({
        fileId: file.fileId,
        fileIndex,
        fileName: file.name,
        format,
        recordCount: 0,
        status: "error",
        error: message,
      });
      warnings.push({ code: "file-error", message: `${file.name}: ${message}` });
    }
    onProgress?.(Math.round(((fileIndex + 1) / Math.max(files.length, 1)) * 45));
  });

  if (records.length === 0) throw new Error("Tidak ada record valid untuk diproses.");
  if (records.length > MAX_CITATION_RECORDS) {
    throw new Error(`Maksimal ${MAX_CITATION_RECORDS.toLocaleString("id-ID")} record per proses.`);
  }

  onProgress?.(60);
  const deduplicated = deduplicateRecords(records);
  warnings.push(...deduplicated.warnings);
  onProgress?.(82);
  const risText = serializeRis(deduplicated.records);
  const auditCsv = serializeAuditCsv(deduplicated.auditEntries);
  onProgress?.(100);

  return {
    files: summaries,
    records: deduplicated.records,
    groups: deduplicated.groups,
    auditEntries: deduplicated.auditEntries,
    warnings,
    inputCount: records.length,
    outputCount: deduplicated.records.length,
    duplicateCount: records.length - deduplicated.records.length,
    ambiguousGroupCount: deduplicated.ambiguousGroupCount,
    normalizedDoiCount: records.filter((record) => record.doiWasNormalized).length,
    risText,
    auditCsv,
  };
}
