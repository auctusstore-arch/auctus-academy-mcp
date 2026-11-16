/**
 * Saring corpus access. Records live in R2 as gzip JSON
 * (`{owner_id}/{project_id}/records.json.gz`, auctus-academy SaringCorpus).
 * The Worker reads R2 only after `mcp.saring_corpus_ref` passed as the user.
 */
import { isMockMode } from "../config";
import { readCapped } from "../lib/read-capped";
import { wrapUntrustedText, type UntrustedText } from "../security/untrusted";
import { mockCorpus } from "./mock-rpc";

export type CorpusRecord = {
  id: string;
  title?: string;
  authors?: string[];
  year?: string;
  journal?: string;
  doi?: string;
  pmid?: string;
  abstract?: string;
  type?: string;
  keywords?: string[];
};

export type Corpus = { projectId: string; records: CorpusRecord[] };

/** Same shape the SQL accepts for decisions; anything else in a corpus is dropped. */
const RECORD_ID = /^[A-Za-z0-9:_.-]{1,200}$/;
const R2_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/records\.json\.gz$/;
const MAX_CORPUS_BYTES = 30 * 1024 * 1024;
const CACHE_LIMIT = 3;
const cache = new Map<string, Corpus>();

/** Decompressed size cap: a corpus of 10,000 records is far below this; protects against a gzip bomb. */
const MAX_CORPUS_DECOMPRESSED_BYTES = 120 * 1024 * 1024;

async function gunzipJson(body: ReadableStream<Uint8Array>): Promise<unknown> {
  const bytes = await readCapped(body.pipeThrough(new DecompressionStream("gzip")), MAX_CORPUS_DECOMPRESSED_BYTES);
  if (!bytes) throw new Error("corpus_too_large");
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export function normalizeCorpus(projectId: string, raw: unknown): Corpus {
  const records = (raw as { records?: unknown } | null)?.records;
  if (!Array.isArray(records)) throw new Error("corpus_invalid");
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
  return {
    projectId,
    records: records
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string" && RECORD_ID.test((r as { id: string }).id))
      .map((r) => ({
        id: String(r.id).slice(0, 200),
        title: str(r.title, 2000),
        authors: Array.isArray(r.authors) ? r.authors.filter((a): a is string => typeof a === "string").map((a) => a.slice(0, 200)) : [],
        year: str(r.year, 12),
        journal: str(r.journal, 300),
        doi: str(r.doi, 300),
        pmid: str(r.pmid, 20),
        abstract: str(r.abstract, 20_000),
        type: str(r.type, 40),
        keywords: Array.isArray(r.keywords) ? r.keywords.filter((k): k is string => typeof k === "string").slice(0, 30) : [],
      })),
  };
}

/** Loads the corpus for a project the caller was already authorized for. */
export async function loadCorpus(env: Env, projectId: string, r2Key: string): Promise<Corpus> {
  const cacheKey = `${projectId}:${r2Key}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  let corpus: Corpus;
  if (isMockMode(env) || !env.SARING_CORPUS) {
    if (!isMockMode(env)) throw new Error("corpus_unavailable");
    corpus = normalizeCorpus(projectId, mockCorpus(projectId));
  } else {
    if (!R2_KEY.test(r2Key) || !r2Key.includes(projectId)) throw new Error("corpus_invalid");
    const object = await env.SARING_CORPUS.get(r2Key);
    if (!object) throw new Error("corpus_unavailable");
    if (object.size > MAX_CORPUS_BYTES) throw new Error("corpus_too_large");
    corpus = normalizeCorpus(projectId, await gunzipJson(object.body));
  }
  cache.set(cacheKey, corpus);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return corpus;
}

export type DecisionRow = { status: string; reason: string; note: string; decided_by_me?: boolean };

export type RecordView = {
  record_id: string;
  title: UntrustedText;
  authors: UntrustedText;
  year: string | null;
  journal: UntrustedText | null;
  doi: string | null;
  pmid: string | null;
  abstract?: UntrustedText;
  decision: { status: string; reason: UntrustedText | ""; note: UntrustedText | "" };
};

export function recordView(r: CorpusRecord, d: DecisionRow | undefined, withAbstract: boolean, abstractMax = 4000): RecordView {
  return {
    record_id: r.id,
    title: wrapUntrustedText(r.title ?? "", 600),
    authors: wrapUntrustedText((r.authors ?? []).slice(0, 6).join("; "), 600),
    year: r.year || null,
    journal: r.journal ? wrapUntrustedText(r.journal, 300) : null,
    doi: r.doi || null,
    pmid: r.pmid || null,
    ...(withAbstract ? { abstract: wrapUntrustedText(r.abstract ?? "", abstractMax) } : {}),
    // Reasons and notes may come from collaborators or other AI clients: data, not instructions.
    decision: {
      status: d?.status ?? "undecided",
      reason: d?.reason ? wrapUntrustedText(d.reason, 2000) : "",
      note: d?.note ? wrapUntrustedText(d.note, 4000) : "",
    },
  };
}

/** Filters and paginates records with an opaque numeric cursor (offset). */
export function pageRecords(
  corpus: Corpus,
  decisions: Record<string, DecisionRow>,
  opts: { status?: string; query?: string; cursor?: string; limit: number; withAbstract: boolean },
): { records: RecordView[]; next_cursor: string | null; total_matching: number } {
  const q = opts.query?.trim().toLowerCase();
  const matching = corpus.records.filter((r) => {
    const status = decisions[r.id]?.status ?? "undecided";
    if (opts.status && status !== opts.status) return false;
    if (q && !`${r.title ?? ""} ${(r.authors ?? []).join(" ")} ${r.doi ?? ""} ${r.pmid ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const offset = opts.cursor && /^\d{1,6}$/.test(opts.cursor) ? Number(opts.cursor) : 0;
  const slice = matching.slice(offset, offset + opts.limit);
  const next = offset + slice.length < matching.length ? String(offset + slice.length) : null;
  return {
    records: slice.map((r) => recordView(r, decisions[r.id], opts.withAbstract, 1500)),
    next_cursor: next,
    total_matching: matching.length,
  };
}
