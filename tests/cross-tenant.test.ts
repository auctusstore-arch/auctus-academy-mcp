import { describe, expect, it } from "vitest";
import { MOCK_USERS, mockListRecords } from "../src/data/mock-store";

describe("cross-tenant isolation (mock)", () => {
  it("user A cannot read user B project records", () => {
    expect(() => mockListRecords(MOCK_USERS.USER_A, MOCK_USERS.PROJECT_B)).toThrow("forbidden");
  });

  it("user B cannot read user A project", () => {
    expect(() => mockListRecords(MOCK_USERS.USER_B, MOCK_USERS.PROJECT_A)).toThrow("forbidden");
  });
});