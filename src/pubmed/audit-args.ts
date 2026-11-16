import { createHash } from "../lib/hash";

/** Privacy: never log full PubMed query strings in audit payloads — hash + length only. */
export async function pubmedAuditArgsHash(
  tool: string,
  args: Record<string, unknown>,
): Promise<{ argsHash: string; recordCount?: number }> {
  const redacted: Record<string, unknown> = { tool };

  if (typeof args.query === "string") {
    redacted.query_len = args.query.length;
    redacted.query_sha256 = await createHash(args.query);
  }
  if (typeof args.term === "string") {
    redacted.term_len = args.term.length;
    redacted.term_sha256 = await createHash(args.term);
  }
  if (typeof args.pmid === "string") redacted.pmid = args.pmid;
  if (typeof args.relation === "string") redacted.relation = args.relation;
  if (typeof args.sort === "string") redacted.sort = args.sort;
  if (Array.isArray(args.pmids)) {
    redacted.pmid_count = args.pmids.length;
    redacted.pmids_sample = args.pmids.slice(0, 5);
    const recordCount = args.pmids.length;
    return { argsHash: await createHash(JSON.stringify(redacted)), recordCount };
  }
  if (typeof args.max_results === "number") redacted.max_results = args.max_results;
  if (args.min_date) redacted.min_date = args.min_date;
  if (args.max_date) redacted.max_date = args.max_date;
  if (Array.isArray(args.publication_types)) redacted.publication_types = args.publication_types;

  return { argsHash: await createHash(JSON.stringify(redacted)) };
}