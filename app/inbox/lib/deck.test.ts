import { describe, expect, it } from "vitest";
import {
  actionForSwipe,
  advanceIndex,
  exitTransform,
  resolveSwipe,
  retreatIndex,
  SWIPE_DISTANCE_THRESHOLD,
} from "./deck";

describe("resolveSwipe", () => {
  it("returns null when neither axis crosses the threshold", () => {
    expect(resolveSwipe(0, 0)).toBeNull();
    expect(resolveSwipe(40, 30)).toBeNull();
    expect(resolveSwipe(-SWIPE_DISTANCE_THRESHOLD + 1, 0)).toBeNull();
  });

  it("resolves each direction once the threshold is crossed", () => {
    expect(resolveSwipe(120, 0)).toBe("right");
    expect(resolveSwipe(-120, 0)).toBe("left");
    expect(resolveSwipe(0, -120)).toBe("up");
    expect(resolveSwipe(0, 120)).toBe("down");
  });

  it("picks the dominant axis on diagonal drags", () => {
    expect(resolveSwipe(150, 100)).toBe("right");
    expect(resolveSwipe(100, 150)).toBe("down");
    expect(resolveSwipe(-150, -140)).toBe("left");
    expect(resolveSwipe(-140, -150)).toBe("up");
  });

  it("does not fire when the dominant axis is short even if the sum is long", () => {
    // Horizontal is dominant but under threshold: must snap back rather than
    // falling through to the vertical axis.
    expect(resolveSwipe(80, 79)).toBeNull();
  });

  it("honours a custom threshold", () => {
    expect(resolveSwipe(50, 0, { distanceThreshold: 40 })).toBe("right");
    expect(resolveSwipe(50, 0, { distanceThreshold: 200 })).toBeNull();
  });
});

describe("actionForSwipe", () => {
  it("maps directions to the agreed actions", () => {
    expect(actionForSwipe("right", "a")).toEqual({ kind: "toggleSaved", id: "a" });
    expect(actionForSwipe("left", "a")).toEqual({ kind: "markRead", id: "a" });
    expect(actionForSwipe("up", "a")).toEqual({ kind: "open", id: "a" });
    expect(actionForSwipe("down", "a")).toEqual({ kind: "skip", id: "a" });
  });
});

describe("index movement", () => {
  it("advances to one past the last card and stops", () => {
    expect(advanceIndex(0, 3)).toBe(1);
    expect(advanceIndex(2, 3)).toBe(3);
    expect(advanceIndex(3, 3)).toBe(3);
  });

  it("never retreats below zero", () => {
    expect(retreatIndex(2)).toBe(1);
    expect(retreatIndex(0)).toBe(0);
  });
});

describe("exitTransform", () => {
  it("returns a distinct off-screen transform per direction", () => {
    const transforms = (["left", "right", "up", "down"] as const).map(exitTransform);
    expect(new Set(transforms).size).toBe(4);
  });
});
