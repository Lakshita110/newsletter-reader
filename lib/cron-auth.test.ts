import { afterEach, describe, expect, it, vi } from "vitest";
import { isCronAuthorized } from "./cron-auth";

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/cron/test", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isCronAuthorized", () => {
  it("denies everything when CRON_SECRET is unset (fails closed)", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isCronAuthorized(request({ authorization: "Bearer " }))).toBe(false);
    expect(isCronAuthorized(request({ "x-cron-secret": "" }))).toBe(false);
  });

  it("accepts the secret via Authorization: Bearer", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(isCronAuthorized(request({ authorization: "Bearer s3cret" }))).toBe(true);
    expect(isCronAuthorized(request({ authorization: "Bearer wrong" }))).toBe(false);
  });

  it("accepts the secret via x-cron-secret", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(isCronAuthorized(request({ "x-cron-secret": "s3cret" }))).toBe(true);
    expect(isCronAuthorized(request({ "x-cron-secret": "wrong" }))).toBe(false);
  });

  it("denies requests with no credentials at all", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(isCronAuthorized(request({}))).toBe(false);
  });
});
