import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FAST_MODEL_CHAIN,
  SMART_MODEL_CHAIN,
  contentToString,
  modelLabel,
  openRouterChat,
  reasoningFor,
  REASONING_TOKEN_HEADROOM,
  openRouterChatWithFallback,
} from "./openrouter";

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

describe("model tiers", () => {
  it("SMART leads with a stronger model and degrades to the FAST chain", () => {
    expect(SMART_MODEL_CHAIN[0]).not.toBe(FAST_MODEL_CHAIN[0]);
    expect(SMART_MODEL_CHAIN.slice(-FAST_MODEL_CHAIN.length)).toEqual(FAST_MODEL_CHAIN);
  });

  it("labels known models for the UI and falls back to the id's tail", () => {
    expect(modelLabel("openai/gpt-5-mini")).toBe("GPT-5 mini");
    expect(modelLabel("vendor/some-model")).toBe("some-model");
    expect(modelLabel(null)).toBeNull();
  });
});

describe("openRouterChatWithFallback", () => {
  it("skips failing and empty models and reports which one answered", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("gone", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "  " } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await openRouterChatWithFallback({
      apiKey: "k",
      models: ["a/one", "b/two", "c/three"],
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 10,
      timeoutMs: 1000,
      logTag: "test",
    });
    expect(result).toEqual({ ok: true, content: "ok", model: "c/three", finishReason: undefined });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("returns the last status when every model fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no credits", { status: 402 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await openRouterChatWithFallback({
      apiKey: "k",
      models: ["a/one", "b/two"],
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 10,
      timeoutMs: 1000,
      logTag: "test",
    });
    expect(result).toEqual({ ok: false, lastStatus: 402 });
    warn.mockRestore();
  });
});

describe("reasoningFor", () => {
  it("keeps GPT-5 reasoning low so it can't eat the output budget, and leaves other models alone", () => {
    expect(reasoningFor("openai/gpt-5-mini")).toEqual({ effort: "low" });
    expect(reasoningFor("openai/gpt-4o-mini")).toBeUndefined();
  });

  it("is sent in the request body only for GPT-5 models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const base = { apiKey: "k", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 10, timeoutMs: 1000 };
    await openRouterChat({ ...base, model: "openai/gpt-5-mini" });
    await openRouterChat({ ...base, model: "openai/gpt-4o-mini" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning).toEqual({ effort: "low" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).reasoning).toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(10 + REASONING_TOKEN_HEADROOM);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).max_tokens).toBe(10);
  });
});
