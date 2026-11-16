import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_IDLE_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "../src/config";

describe("token lifetime policy (PRD T11)", () => {
  it("access token is 10 minutes", () => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(600);
  });

  it("refresh idle and absolute windows match PRD", () => {
    expect(REFRESH_TOKEN_IDLE_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(REFRESH_TOKEN_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });
});