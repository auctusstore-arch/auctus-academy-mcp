import { isMockMode } from "../config";
import type { ToolContext } from "../data/port";
import { checkNcbiGlobalRateLimit, checkPubMedUserRateLimit } from "../security/rate-limit";
import type { PubmedSearchFilters } from "./eutils";
import { esearchPubmed, getPubmedArticles, meshLookup } from "./eutils";
import { mockMeshLookup, mockPubmedGetArticles, mockPubmedSearch } from "./mock";
import { ncbiCredentialsFromEnv, PubMedClientError } from "./ncbi-client";
import {
  PUBMED_GET_MAX_PMIDS,
  PUBMED_MESH_MAX_RESULTS,
  PUBMED_MESH_TERM_MAX_LEN,
  PUBMED_QUERY_MAX_LEN,
  PUBMED_SEARCH_MAX_RESULTS,
} from "./constants";

export async function assertPubmedRateLimits(ctx: ToolContext): Promise<void> {
  const userRl = await checkPubMedUserRateLimit(ctx.env.MCP_OPS, ctx.userId, ctx.clientId);
  if (!userRl.allowed) throw new Error("rate_limited");
  if (!isMockMode(ctx.env)) {
    const globalRl = await checkNcbiGlobalRateLimit(ctx.env.MCP_OPS);
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
  },
) {
  const query = input.query.trim();
  if (!query || query.length > PUBMED_QUERY_MAX_LEN) throw new Error("invalid_input");
  const max = Math.min(input.max_results ?? PUBMED_SEARCH_MAX_RESULTS, PUBMED_SEARCH_MAX_RESULTS);
  const filters: PubmedSearchFilters = {
    min_date: input.min_date,
    max_date: input.max_date,
    publication_types: input.publication_types,
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