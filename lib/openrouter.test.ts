import { afterEach, describe, expect, it, vi } from "vitest";
import { contentToString, openRouterChat } from "./openrouter";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("contentToString", () => {
  it("passes plain strings through", () => {
    expect(contentToString("hello")).toBe("hello");
  });

  it("joins typed text parts, leaving a blank line for non-text parts", () => {
    expect(
      contentToString([
        { type: "text", text: "line one" },
        { type: "image" },
        { type: "text", text: "line two" },
      ])
    ).toBe("line one\n\nline two");
  });

  it("returns empty string for undefined content", () => {
    expect(contentToString(undefined)).toBe("");
  });
});

describe("openRouterChat", () => {
  const args = {
    apiKey: "test-key",
    model: "test/model",
    maxTokens: 100,
    timeoutMs: 5000,
    messages: [{ role: "user" as const, content: "hi" }],
  };

  it("returns content and finish reason on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ finish_reason: "stop", message: { content: "response text" } }],
        }),
      })
    );
    const result = await openRouterChat(args);
    expect(result).toEqual({ ok: true, content: "response text", finishReason: "stop" });
  });

  it("returns the HTTP status and body on a failed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "rate limited",
      })
    );
    const result = await openRouterChat(args);
    expect(result).toEqual({ ok: false, status: 429, errorBody: "rate limited" });
  });

  it("returns status null when the request throws (network/timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    const result = await openRouterChat(args);
    expect(result).toEqual({ ok: false, status: null, errorBody: "boom" });
  });
});
