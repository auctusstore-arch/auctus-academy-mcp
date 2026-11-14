export type WhoamiResult = {
  user_id: string;
  entitlement: { allowed: boolean; basis?: string; tier?: string | null; reason?: string };
  scopes: string[];
  ma_quota: { maxPapers: number; maxOutcomes: number; paperCount: number; outcomeCount: number };
  mcp_pilot: { enabled: boolean; allowed: boolean };
};

export type SaringProject = {
  id: string;
  name: string;
  role: "owner" | "collaborator";
  status: string;
};

export type SaringRecord = {
  record_id: string;
  title: string;
  authors: string;
  year: number | null;
  doi: string | null;
  abstract: { untrusted_content: string };
  status: string;
  reason: string;
  note: string;
};