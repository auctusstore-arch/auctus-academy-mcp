/**
 * Phase 2 `dedup.run`: proposals only. Nothing here writes; finalizing a
 * merge or changing the corpus stays on the Auctus web (W3).
 */
import type { CorpusRecord } from "../data/corpus";
import { wrapUntrustedText } from "../security/untrusted";
import { deduplicateRecords, normalizeDoi } from "./engine";
import type { CitationRecord } from "./types";

export const DEDUP_MAX_RECORDS = 10_000;
export const DEDUP_MAX_PROPOSALS = 50;

export function toCitationRecord(r: CorpusRecord, fileId: string, index: number): CitationRecord {
  const doi = r.doi ? normalizeDoi(r.doi) : "";
  return {
    id: r.id,
    source: { fileId, fileName: fileId, fileIndex: 0, recordNumber: index + 1, globalIndex: index, format: "ris" },
    type: r.type ?? "JOUR",
    title: r.title ?? "",
    authors: r.authors ?? [],
    abstract: "",
    journal: r.journal ?? "",
    year: r.year ?? "",
    doiRaw: r.doi ?? "",
    doi,
    doiWasNormalized: !!doi && doi !== r.doi,
    urls: [],
    volume: "",
    issue: "",
    startPage: "",
    endPage: "",
    issn: "",
    pmid: r.pmid ?? "",
    keywords: [],
    language: "",
    publisher: "",
    identifiers: [],
    rawTags: {},
  };
}

const brief = (r: { id: string; title?: string; year?: string; doi?: string }) => ({
  record_id: r.id,
  title: wrapUntrustedText(r.title ?? "", 300),
  year: r.year || null,
  doi: r.doi || null,
});

/**
 * Re-checks a project's corpus. The corpus was already de-duplicated on upload,
 * so this mostly surfaces near-duplicates the engine refused to merge
 * automatically (ambiguous first author / title / year) for a human to judge.
 */
export function analyzeCorpus(records: CorpusRecord[]) {
  if (records.length > DEDUP_MAX_RECORDS) throw new Error("too_many_records");
  const byId = new Map(records.map((r) => [r.id, r]));
  const result = deduplicateRecords(records.map((r, i) => toCitationRecord(r, "corpus", i)));
  const merged = result.groups.map((g) => ({
    method: g.method,
    keep: brief(byId.get(g.kept.id) ?? { id: g.kept.id }),
    duplicates: g.removed.map((x) => brief(byId.get(x.id) ?? { id: x.id })),
  }));
  const ambiguous = result.auditEntries
    .filter((e) => e.outcome === "not-merged" && e.method === "ambiguous-fallback")
    .map((e) => ({
      reason: "ambiguous-fallback",
      records: [e.reference, e.related]
        .map((s) => records[s.globalIndex])
        .filter((r): r is CorpusRecord => !!r)
        .map(brief),
    }));
  const proposals = [...merged.map((m) => ({ kind: "likely_duplicate" as const, ...m })), ...ambiguous.map((a) => ({ kind: "needs_review" as const, ...a }))];
  return {
    record_count: records.length,
    proposal_count: proposals.length,
    proposals: proposals.slice(0, DEDUP_MAX_PROPOSALS),
    truncated: proposals.length > DEDUP_MAX_PROPOSALS,
    note: "Ini hanya usulan. Finalisasi duplikat dilakukan user di web Auctus.",
  };
}

export type CandidateArticle = { pmid: string; title: string; authors: string[]; year: string; doi: string; journal: string };

/** Which candidate articles (e.g. from PubMed) are already in the corpus. */
export function checkCandidates(corpus: CorpusRecord[], candidates: CandidateArticle[]) {
  if (corpus.length + candidates.length > DEDUP_MAX_RECORDS) throw new Error("too_many_records");
  const corpusIds = new Set(corpus.map((r) => r.id));
  const byPmid = new Map(corpus.filter((r) => r.pmid).map((r) => [r.pmid!, r]));
  const candRecords: CorpusRecord[] = candidates.map((c) => ({
    id: `candidate:${c.pmid}`,
    title: c.title,
    authors: c.authors,
    year: c.year,
    doi: c.doi,
    journal: c.journal,
    pmid: c.pmid,
  }));
  const all = [...corpus, ...candRecords].map((r, i) => toCitationRecord(r, r.id.startsWith("candidate:") ? "candidate" : "corpus", i));
  const result = deduplicateRecords(all);
  const matchOf = new Map<string, string>();
  for (const g of result.groups) {
    const members = [g.kept.id, ...g.removed.map((x) => x.id)];
    const existing = members.find((id) => corpusIds.has(id));
    if (!existing) continue;
    for (const id of members) if (id.startsWith("candidate:")) matchOf.set(id, existing);
  }
  return {
    checked: candidates.length,
    results: candidates.map((c) => {
      const viaPmid = byPmid.get(c.pmid);
      const match = viaPmid?.id ?? matchOf.get(`candidate:${c.pmid}`);
      return { pmid: c.pmid, already_in_project: !!match, matched_record_id: match ?? null, matched_by: viaPmid ? "pmid" : match ? "doi_or_title" : null };
    }),
  };
}
