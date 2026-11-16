import { describe, expect, it } from "vitest";
import { AuditLogSink } from "../src/audit/logger";

describe("audit hash chain", () => {
  it("verifies append-only chain", async () => {
    const sink = new AuditLogSink();
    await sink.append({
      userId: "u1",
      clientId: "c1",
      tool: "auctus_whoami",
      scope: "sr.read",
      argsHash: "abc",
      status: "ok",
    });
    await sink.append({
      userId: "u1",
      clientId: "c1",
      tool: "auctus_saring_list_projects",
      scope: "sr.read",
      argsHash: "def",
      status: "ok",
    });
    expect(await sink.verifyChain()).toBe(true);
  });
});