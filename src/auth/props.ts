import type { UpstreamTokens } from "./upstream";

/** Encrypted grant props (only the Worker holding the token can decrypt them). */
export type AuthProps = {
  userId: string;
  /** Supabase tokens for this grant. Absent only in MOCK_MODE. Never sent to clients. */
  upstream?: UpstreamTokens;
};
