import { isMockMode } from "../config";
import type { ToolContext } from "../data/port";
import { checkNcbiGlobalRateLimit, checkPubMedUserRateLimit } from "../security/rate-limit";
import type { PubmedRelation, PubmedSearchFilters } from "./eutils";
import { elinkPubmed, esearchPubmed, getPubmedArticles, meshLookup, RELATION_LINKNAME, verifyPmids } from "./eutils";
import { mockFindRelated, mockMeshLookup, mockPubmedGetArticles, mockPubmedSearch, mockVerifyPmids } from "./mock";
import { ncbiCredentialsFromEnv, PubMedClientError } from "./ncbi-client";
import {
  PUBMED_GET_MAX_PMIDS,
  PUBMED_MESH_MAX_RESULTS,
  PUBMED_MESH_TERM_MAX_LEN,
  PUBMED_QUERY_MAX_LEN,
  PUBMED_RELATED_MAX_RESULTS,
  PUBMED_SEARCH_MAX_RESULTS,
  PUBMED_VERIFY_MAX_PMIDS,
} from "./constants";

export async function assertPubmedRateLimits(ctx: ToolContext): Promise<void> {
  const userRl = await checkPubMedUserRateLimit(ctx.env, ctx.userId, ctx.clientId);
  if (!userRl.allowed) throw new Error("rate_limited");
  if (!isMockMode(ctx.env)) {
    const globalRl = await checkNcbiGlobalRateLimit(ctx.env);
    if (!globalRl.allowed) throw new Error("rate_limited");
  }
}

export async function toolPubmedSearch(
  ctx: ToolContext,
  input: {
    query: string;
    max_results?: number;
    min_date?: string;
    max_date?: string;
    publication_types?: string[];
    sort?: "relevance" | "pub_date";
  },
) {
  const query = input.query.trim();
  if (!query || query.length > PUBMED_QUERY_MAX_LEN) throw new Error("invalid_input");
  const max = Math.min(input.max_results ?? PUBMED_SEARCH_MAX_RESULTS, PUBMED_SEARCH_MAX_RESULTS);
  const filters: PubmedSearchFilters = {
    min_date: input.min_date,
    max_date: input.max_date,
    publication_types: input.publication_types,
    sort: input.sort,
  };

  await assertPubmedRateLimits(ctx);

  if (isMockMode(ctx.env)) {
    return mockPubmedSearch(query, max);
  }

  try {
    const creds = ncbiCredentialsFromEnv(ctx.env);
    return await esearchPubmed(creds, query, max, filters);
  } catch (e) {
    if (e instanceof PubMedClientError) throw new Error(e.message);
    if (e instanceof Error && e.message === "ncbi_invalid_response") throw new Error("pubmed_unavailable");
    throw new Error("pubmed_unavailable");
  }
}

export async function toolPubmedGetArticles(ctx: ToolContext, pmids: string[]) {
  if (!pmids.length) throw new Error("invalid_input");
  if (pmids.length > PUBMED_GET_MAX_PMIDS) throw new Error("invalid_input");

  await assertPubmedRateLimits(ctx);

  if (isMockMode(ctx.env)) {
    return { articles: mockPubmedGetArticles(pmids), truncated: pmids.length > PUBMED_GET_MAX_PMIDS };
  }

  try {
    const creds = ncbiCredentialsFromEnv(ctx.env);
    const articles = await getPubmedArticles(creds, pmids);
    return { articles, truncated: pmids.length > articles.length };
  } catch (e) {
    if (e instanceof PubMedClientError) throw new Error(e.message);
    throw new Error("pubmed_unavailable");
  }
}

export async function toolPubmedMeshLookup(
  ctx: ToolContext,
  input: { term: string; max_results?: number },
) {
  const term = input.term.trim();
  if (!term || term.length > PUBMED_MESH_TERM_MAX_LEN) throw new Error("invalid_input");
  const max = Math.min(input.max_results ?? PUBMED_MESH_MAX_RESULTS, PUBMED_MESH_MAX_RESULTS);

  await assertPubmedRateLimits(ctx);

  if (isMockMode(ctx.env)) {
    return { terms: mockMeshLookup(term) };
  }

  try {
    const creds = ncbiCredentialsFromEnv(ctx.env);
    const terms = await meshLookup(creds, term, max);
    return { terms };
  } catch (e) {
    if (e instanceof PubMedClientError) throw new Error(e.message);
    throw new Error("pubmed_unavailable");
  }
}
/**
 * Checks PMIDs a model cited: exists on PubMed, date, publication types, review flag.
 * Built for the Idea Board AI track (feasibility evidence and "latest SR" novelty check).
 */
export async function toolPubmedVerifyPmids(ctx: ToolContext, pmidsInput: string[]) {
  const pmids = [...new Set(pmidsInput.map((p) => p.trim()))];
  if (!pmids.length || pmids.length > PUBMED_VERIFY_MAX_PMIDS || !pmids.every((p) => /^\d{1,9}$/.test(p))) {
    throw new Error("invalid_input");
  }

  await assertPubmedRateLimits(ctx);

  const rows = isMockMode(ctx.env) ? mockVerifyPmids(pmids) : await callNcbi(() => verifyPmids(ncbiCredentialsFromEnv(ctx.env), pmids));
  return {
    checked: rows.length,
    found: rows.filter((r) => r.found).length,
    not_found: rows.filter((r) => !r.found).map((r) => r.pmid),
    articles: rows,
  };
}

export async function toolPubmedFindRelated(
  ctx: ToolContext,
  input: { pmid: string; relation: PubmedRelation; max_results?: number },
) {
  const pmid = input.pmid.trim();
  if (!/^\d{1,9}$/.test(pmid) || !(input.relation in RELATION_LINKNAME)) throw new Error("invalid_input");
  const max = Math.min(input.max_results ?? PUBMED_RELATED_MAX_RESULTS, PUBMED_RELATED_MAX_RESULTS);

  await assertPubmedRateLimits(ctx);

  if (isMockMode(ctx.env)) return mockFindRelated(pmid, input.relation, max);
  return callNcbi(() => elinkPubmed(ncbiCredentialsFromEnv(ctx.env), pmid, input.relation, max));
}

async function callNcbi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PubMedClientError) throw new Error(e.message);
    throw new Error("pubmed_unavailable");
  }
}
