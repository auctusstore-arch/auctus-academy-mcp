import { createHash } from "../lib/hash";

export type ToolDef = {
  name: string;
  description: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint?: boolean;
};

export const PHASE0_TOOLS: ToolDef[] = [
  { name: "auctus_whoami", description: "Package, access basis, granted scopes, MA quota.", readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  { name: "auctus_saring_list_projects", description: "List Saring projects owned or shared with the user.", readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  { name: "auctus_saring_project_summary", description: "Counts per status, duplicate groups, collaborator count (no email).", readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  { name: "auctus_saring_list_records", description: "Paginated screening records with untrusted abstracts.", readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  { name: "auctus_saring_get_record", description: "Single screening record.", readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  { name: "auctus_ma_list_papers", description: "List MA papers (research.projects).", readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  { name: "auctus_ma_get_paper", description: "Paper identity and outcomes list.", readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  { name: "auctus_ma_get_outcome_data", description: "Study rows for an outcome.", readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  { name: "auctus_ma_get_rob", description: "Risk of bias assessments.", readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  { name: "auctus_ma_get_grade", description: "GRADE certainty and domains.", readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  { name: "auctus_ma_check_ready", description: "Read-only readiness validation for MA run.", readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  { name: "auctus_ma_list_jobs", description: "Job status summaries (no file URLs).", readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  { name: "auctus_ma_get_job", description: "Single job summary (no file URLs).", readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  {
    name: "auctus_pubmed_search",
    description: "Search PubMed via NCBI E-utilities; PMIDs only (no abstracts).",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  {
    name: "auctus_pubmed_get_articles",
    description: "Fetch PubMed article metadata/abstracts (untrusted third-party text).",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  {
    name: "auctus_pubmed_mesh_lookup",
    description: "Look up MeSH headings via NCBI MeSH database.",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
];

export async function catalogSha256(): Promise<string> {
  const canonical = JSON.stringify(PHASE0_TOOLS);
  return createHash(canonical);
}

export async function catalogWellKnownJson(): Promise<Record<string, unknown>> {
  return {
    version: "phase0",
    tool_prefix: "auctus_",
    tools: PHASE0_TOOLS,
    catalog_sha256: await catalogSha256(),
  };
}