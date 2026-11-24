import { describe, expect, it } from "vitest";
import { readConnectResult } from "./MailboxesSection";

describe("readConnectResult", () => {
  it("explains known failure reasons", () => {
    expect(readConnectResult("?gmail=error&reason=state")).toContain("browser");
    expect(readConnectResult("?gmail=error&reason=no-refresh-token")).toContain("permissions");
  });

  it("never hides an unknown reason", () => {
    expect(readConnectResult("?gmail=error&reason=invalid_client")).toContain("invalid_client");
  });

  it("handles success, cancel and nothing", () => {
    expect(readConnectResult("?gmail=connected")).toMatch(/connected/i);
    expect(readConnectResult("?gmail=cancelled")).toBe("Nothing was changed.");
    expect(readConnectResult("")).toBeNull();
  });
});
