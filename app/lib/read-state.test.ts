import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLocalEditsSince,
  clearLocalEditsForTests,
  postReadState,
  readStateClock,
  setReadStateClockForTests,
} from "./read-state";

let clock = 0;
const fetchMock = vi.fn();

beforeEach(() => {
  clock = 1000;
  setReadStateClockForTests(() => clock);
  clearLocalEditsForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** A fetch that resolves only when the test says so, to model a slow request. */
function deferredOk() {
  let resolve!: () => void;
  fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = () => r({ ok: true }))));
  return () => resolve();
}

describe("applyLocalEditsSince", () => {
  it("keeps a Done tapped while a slow snapshot was loading", async () => {
    const since = readStateClock(); // Today starts loading
    clock = 2000;
    fetchMock.mockResolvedValueOnce({ ok: true });
    await postReadState({ messageId: "a", state: "read" }); // she swipes meanwhile

    // The snapshot was taken before the swipe reached the server.
    const merged = applyLocalEditsSince(since, {}, {});
    expect(merged.status).toEqual({ a: "read" });
  });

  it("keeps a Done that was still saving when the next load started", async () => {
    const finish = deferredOk();
    const pending = postReadState({ messageId: "a", state: "read" }); // Done in the reader
    clock = 1500;
    const since = readStateClock(); // straight back to Today
    expect(applyLocalEditsSince(since, {}, {}).status).toEqual({ a: "read" });
    finish();
    await pending;
    expect(applyLocalEditsSince(since, {}, {}).status).toEqual({ a: "read" });
  });

  it("trusts the server for edits it confirmed before the snapshot", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    await postReadState({ messageId: "a", state: "read" });
    clock = 5000;
    // Later the item was marked unread on another device; the server knows best.
    expect(applyLocalEditsSince(readStateClock(), {}, {}).status).toEqual({});
  });

  it("applies edits in order, including unread and saves", async () => {
    const since = readStateClock();
    fetchMock.mockResolvedValue({ ok: true });
    await postReadState({ messageIds: ["a", "b"], state: "read" });
    await postReadState({ messageId: "a", state: "unread" });
    await postReadState({ messageId: "c", state: "saved" });
    const merged = applyLocalEditsSince(since, { a: "read" }, { d: true });
    expect(merged.status).toEqual({ b: "read" });
    expect(merged.saved).toEqual({ c: true, d: true });
  });

  it("forgets a change the server rejected, and still throws", async () => {
    const since = readStateClock();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(postReadState({ messageId: "a", state: "read" })).rejects.toThrow("read-state 500");
    expect(applyLocalEditsSince(since, {}, {}).status).toEqual({});
  });

  it("never treats opening an item as a status change", async () => {
    const since = readStateClock();
    fetchMock.mockResolvedValueOnce({ ok: true });
    await postReadState({ messageId: "a", state: "opened" });
    expect(applyLocalEditsSince(since, { a: "read" }, {}).status).toEqual({ a: "read" });
  });
});
