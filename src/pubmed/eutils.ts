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