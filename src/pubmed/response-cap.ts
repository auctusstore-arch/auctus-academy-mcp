import { MAX_RESPONSE_BYTES } from "../config";

export function capJsonResponse(payload: unknown): { body: string; truncated: boolean } {
  let text = JSON.stringify(payload, null, 2);
  let truncated = false;
  if (text.length > MAX_RESPONSE_BYTES) {
    text = `${text.slice(0, MAX_RESPONSE_BYTES)}\n[response_truncated]`;
    truncated = true;
  }
  return { body: text, truncated };
}