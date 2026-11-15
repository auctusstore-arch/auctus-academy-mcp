import { wrapUntrustedText } from "../security/untrusted";
import type { NcbiCredentials } from "./ncbi-client";
import { ncbiGet } from "./ncbi-client";
import {
  PUBMED_ABSTRACT_MAX_CHARS,
  PUBMED_GET_MAX_PMIDS,
  PUBMED_SEARCH_MAX_RESULTS,
  PUBMED_TITLE_MAX_CHARS,
} from "./constants";

export type PubmedSearchFilters = {
  min_date?: string;
  max_date?: string;
  publication_types?: string[];
  /** "pub_date" = newest first (e.g. latest systematic review). Default relevance. */
  sort?: "relevance" | "pub_date";
};

export type PubmedSearchResult = {
  query_echo: { length: number; term_digest: string };
  total: number;
  pmids: string[];
  capped: boolean;
};

export type PubmedArticle = {
  pmid: string;
  title: ReturnType<typeof wrapUntrustedText>;
  abstract: ReturnType<typeof wrapUntrustedText>;
  journal?: string;
  pub_date?: string;
  authors?: string[];
  doi?: string;
  publication_types?: string[];
};

function parseJsonSafe<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("ncbi_invalid_response");
  }
}

function termDigest(term: string): string {
  const slice = term.slice(0, 64);
  return slice.length === term.length ? slice : `${slice}…`;
}

export async function esearchPubmed(
  creds: NcbiCredentials,
  query: string,
  retmax: number,
  filters?: PubmedSearchFilters,
): Promise<PubmedSearchResult> {
  const cappedMax = Math.min(retmax, PUBMED_SEARCH_MAX_RESULTS);
  const params: Record<string, string | number | undefined> = {
    db: "pubmed",
    term: query,
    retmax: cappedMax,
    retmode: "json",
  };
  if (filters?.min_date) {
    params.mindate = filters.min_date;
    params.datetype = "pdat";
  }
  if (filters?.max_date) {
    params.maxdate = filters.max_date;
    params.datetype = "pdat";
  }
  if (filters?.publication_types?.length) {
    const pt = filters.publication_types.map((p) => `"${p.replace(/"/g, "")}"[pt]`).join(" OR ");
    params.term = `(${query}) AND (${pt})`;
  }
  if (filters?.sort === "pub_date") params.sort = "pub_date";

  const body = await ncbiGet("/entrez/eutils/esearch.fcgi", params, creds);
  const data = parseJsonSafe<{
    esearchresult?: { count?: string; idlist?: string[] };
  }>(body);
  const result = data.esearchresult;
  const total = Number(result?.count ?? 0);
  const idlist = result?.idlist ?? [];
  return {
    query_echo: { length: query.length, term_digest: termDigest(query) },
    total,
    pmids: idlist,
    capped: total > idlist.length,
  };
}

type ESummaryDoc = {
  title?: string;
  fulljournalname?: string;
  pubdate?: string;
  authors?: { name: string }[];
  articleids?: { idtype: string; value: string }[];
  pubtype?: string[];
};

export async function efetchAbstracts(creds: NcbiCredentials, pmids: string[]): Promise<Map<string, string>> {
  if (!pmids.length) return new Map();
  const body = await ncbiGet(
    "/entrez/eutils/efetch.fcgi",
    { db: "pubmed", id: pmids.join(","), retmode: "xml" },
    creds,
  );
  const map = new Map<string, string>();
  const blocks = body.split(/<PubmedArticle>/);
  for (const block of blocks) {
    const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    const pmid = pmidMatch?.[1];
    if (!pmid) continue;
    const abstractParts = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((m) =>
      stripXml(m[1] ?? ""),
    );
    map.set(pmid, abstractParts.join("\n"));
  }
  return map;
}

function stripXml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export async function getPubmedArticles(creds: NcbiCredentials, pmidsInput: string[]): Promise<PubmedArticle[]> {
  const pmids = [...new Set(pmidsInput.map((p) => p.replace(/\D/g, "")).filter(Boolean))].slice(
    0,
    PUBMED_GET_MAX_PMIDS,
  );
  if (!pmids.length) return [];

  const summaryBody = await ncbiGet(
    "/entrez/eutils/esummary.fcgi",
    { db: "pubmed", id: pmids.join(","), retmode: "json" },
    creds,
  );
  const summary = parseJsonSafe<{ result?: Record<string, ESummaryDoc | string> }>(summaryBody);
  const abstracts = await efetchAbstracts(creds, pmids);

  const articles: PubmedArticle[] = [];
  for (const pmid of pmids) {
    const doc = summary.result?.[pmid];
    if (!doc || typeof doc === "string") continue;
    const doi = doc.articleids?.find((a) => a.idtype === "doi")?.value;
    articles.push({
      pmid,
      title: wrapUntrustedText(doc.title ?? "", PUBMED_TITLE_MAX_CHARS),
      abstract: wrapUntrustedText(abstracts.get(pmid) ?? "", PUBMED_ABSTRACT_MAX_CHARS),
      journal: doc.fulljournalname,
      pub_date: doc.pubdate,
      authors: doc.authors?.map((a) => a.name).slice(0, 20),
      doi,
      publication_types: doc.pubtype,
    });
  }
  return articles;
}

export type MeshLookupHit = {
  uid: string;
  name: ReturnType<typeof wrapUntrustedText>;
  tree_numbers?: string[];
};

export async function meshLookup(creds: NcbiCredentials, term: string, retmax: number): Promise<MeshLookupHit[]> {
  const searchBody = await ncbiGet(
    "/entrez/eutils/esearch.fcgi",
    { db: "mesh", term, retmax: Math.min(retmax, 15), retmode: "json" },
    creds,
  );
  const search = parseJsonSafe<{ esearchresult?: { idlist?: string[] } }>(searchBody);
  const ids = search.esearchresult?.idlist ?? [];
  if (!ids.length) return [];

  const summaryBody = await ncbiGet(
    "/entrez/eutils/esummary.fcgi",
    { db: "mesh", id: ids.join(","), retmode: "json" },
    creds,
  );
  const summary = parseJsonSafe<{
    result?: Record<string, { ds_meshterms?: string[]; tree?: string[] } | string>;
  }>(summaryBody);

  return ids.map((uid) => {
    const row = summary.result?.[uid];
    const name = row && typeof row !== "string" ? (row.ds_meshterms?.[0] ?? term) : term;
    return {
      uid,
      name: wrapUntrustedText(name, 256),
      tree_numbers: row && typeof row !== "string" ? row.tree : undefined,
    };
  });
}
/** Publication types counted as reviews (mirrors auctus-academy idea-board REVIEW_PUB_TYPES). */
export const REVIEW_PUB_TYPES = new Set(
  [
    "Systematic Review",
    "Meta-Analysis",
    "Network Meta-Analysis",
    "Review",
    "Guideline",
    "Practice Guideline",
    "Scoping Review",
  ].map((t) => t.toLowerCase()),
);

export function isReviewPubTypes(pubTypes: string[]): boolean {
  return pubTypes.some((t) => REVIEW_PUB_TYPES.has(t.trim().toLowerCase()));
}

/** esummary `sortpubdate` ("2025/11/03 00:00") to ISO date, else null. */
export function isoFromSortPubDate(value: unknown): string | null {
  const match = typeof value === "string" ? value.match(/^(\d{4})\/(\d{2})\/(\d{2})/) : null;
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export type PmidVerification = {
  pmid: string;
  /** False when PubMed has no record: the PMID may be invented by the model. */
  found: boolean;
  title: ReturnType<typeof wrapUntrustedText> | null;
  journal: string | null;
  pub_date_iso: string | null;
  publication_types: string[];
  is_review: boolean;
};

/** Parses an esummary JSON body into one verification row per requested PMID. */
export function parseVerifyEsummary(body: unknown, requested: string[]): PmidVerification[] {
  const result = (body as { result?: Record<string, unknown> } | null)?.result ?? {};
  return requested.map((pmid) => {
    const doc = result[pmid] as (ESummaryDoc & { error?: unknown; sortpubdate?: string; source?: string }) | undefined;
    const title = typeof doc?.title === "string" ? stripXml(doc.title) : "";
    if (!doc || typeof doc !== "object" || doc.error || !title) {
      return { pmid, found: false, title: null, journal: null, pub_date_iso: null, publication_types: [], is_review: false };
    }
    const pubTypes = Array.isArray(doc.pubtype) ? doc.pubtype.map(String).slice(0, 30) : [];
    return {
      pmid,
      found: true,
      title: wrapUntrustedText(title, PUBMED_TITLE_MAX_CHARS),
      journal: String(doc.fulljournalname || doc.source || "").slice(0, 300) || null,
      pub_date_iso: isoFromSortPubDate(doc.sortpubdate),
      publication_types: pubTypes,
      is_review: isReviewPubTypes(pubTypes),
    };
  });
}

export async function verifyPmids(creds: NcbiCredentials, pmids: string[]): Promise<PmidVerification[]> {
  if (!pmids.length) return [];
  const body = await ncbiGet(
    "/entrez/eutils/esummary.fcgi",
    { db: "pubmed", id: pmids.join(","), retmode: "json" },
    creds,
  );
  return parseVerifyEsummary(parseJsonSafe<unknown>(body), pmids);
}

export type PubmedRelation = "similar" | "cited_by" | "references";

export const RELATION_LINKNAME: Record<PubmedRelation, string> = {
  similar: "pubmed_pubmed",
  cited_by: "pubmed_pubmed_citedin",
  references: "pubmed_pubmed_refs",
};

export type RelatedResult = { pmid: string; relation: PubmedRelation; total: number; pmids: string[]; capped: boolean };

/** Parses an elink JSON body; only links under the requested linkname are returned. */
export function parseElink(body: unknown, linkname: string): string[] {
  const linksets = (body as { linksets?: { linksetdbs?: { linkname?: string; links?: unknown[] }[] }[] } | null)
    ?.linksets;
  const db = linksets?.[0]?.linksetdbs?.find((d) => d.linkname === linkname);
  return (db?.links ?? []).map(String).filter((id) => /^\d{1,9}$/.test(id));
}

export async function elinkPubmed(
  creds: NcbiCredentials,
  pmid: string,
  relation: PubmedRelation,
  max: number,
): Promise<RelatedResult> {
  const linkname = RELATION_LINKNAME[relation];
  const body = await ncbiGet(
    "/entrez/eutils/elink.fcgi",
    { dbfrom: "pubmed", db: "pubmed", id: pmid, linkname, retmode: "json" },
    creds,
  );
  // NCBI lists the source PMID itself first for "similar"; drop it.
  const all = parseElink(parseJsonSafe<unknown>(body), linkname).filter((id) => id !== pmid);
  const pmids = all.slice(0, max);
  return { pmid, relation, total: all.length, pmids, capped: all.length > pmids.length };
}
