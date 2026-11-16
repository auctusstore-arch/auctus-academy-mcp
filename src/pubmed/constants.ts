/** NCBI E-utilities — sole allowed origin for PubMed traffic (SSRF guard). */
export const NCBI_EUTILS_ORIGIN = "https://eutils.ncbi.nlm.nih.gov";

export const PUBMED_SEARCH_MAX_RESULTS = 25;
export const PUBMED_GET_MAX_PMIDS = 20;
export const PUBMED_MESH_MAX_RESULTS = 15;
export const PUBMED_QUERY_MAX_LEN = 500;
export const PUBMED_MESH_TERM_MAX_LEN = 200;

export const PUBMED_TITLE_MAX_CHARS = 512;
export const PUBMED_ABSTRACT_MAX_CHARS = 4000;

export const NCBI_REQUEST_TIMEOUT_MS = 15_000;

/** Per user+client PubMed tool calls (in addition to global MCP read limit). */
export const PUBMED_USER_RATE_PER_MINUTE = 30;

/** NCBI guideline: ≤10 requests/s with API key (global across Worker). */
export const NCBI_GLOBAL_RATE_PER_SECOND = 10;

export const PUBMED_TOOL_NAMES = new Set([
  "auctus_pubmed_search",
  "auctus_pubmed_get_articles",
  "auctus_pubmed_mesh_lookup",
  "auctus_pubmed_verify_pmids",
  "auctus_pubmed_find_related",
]);

export const PUBMED_VERIFY_MAX_PMIDS = 50;
export const PUBMED_RELATED_MAX_RESULTS = 25;