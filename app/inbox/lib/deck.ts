/**
 * Pure gesture -> action mapping for the swipe deck.
 *
 * This lives outside the component on purpose: the project's Vitest setup runs
 * in a plain node environment with no jsdom/RTL, so anything that needs a DOM
 * is untestable today. Keeping the decision logic here means the part that can
 * actually be wrong (threshold, axis dominance, index bounds) has real tests,
 * while FeedDeck stays a thin rendering shell over it.
 */

export type SwipeDirection = "left" | "right" | "up" | "down";

export type DeckAction =
  | { kind: "markRead"; id: string }
  | { kind: "toggleSaved"; id: string }
  | { kind: "open"; id: string }
  | { kind: "skip"; id: string };

/** How far the card must travel before a drag counts as a swipe. */
export const SWIPE_DISTANCE_THRESHOLD = 90;

export function actionForSwipe(direction: SwipeDirection, id: string): DeckAction {
  switch (direction) {
    case "right":
      return { kind: "toggleSaved", id };
    case "left":
      return { kind: "markRead", id };
    case "up":
      return { kind: "open", id };
    case "down":
      return { kind: "skip", id };
  }
}

/**
 * Resolve a drag offset into a swipe direction, or null when the gesture
 * should snap back. The dominant axis wins so a sloppy diagonal drag still
 * does the thing the user mostly meant.
 */
export function resolveSwipe(
  dx: number,
  dy: number,
  opts: { distanceThreshold?: number } = {}
): SwipeDirection | null {
  const threshold = opts.distanceThreshold ?? SWIPE_DISTANCE_THRESHOLD;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX >= absY) {
    if (absX < threshold) return null;
    return dx > 0 ? "right" : "left";
  }

  if (absY < threshold) return null;
  return dy > 0 ? "down" : "up";
}

/** Clamp forward movement so we stop one past the last card (the empty state). */
export function advanceIndex(index: number, total: number): number {
  return Math.min(index + 1, total);
}

export function retreatIndex(index: number): number {
  return Math.max(index - 1, 0);
}

/** Off-screen translation used to fly the card away once a swipe commits. */
export function exitTransform(direction: SwipeDirection): string {
  switch (direction) {
    case "right":
      return "translate(140%, 0) rotate(18deg)";
    case "left":
      return "translate(-140%, 0) rotate(-18deg)";
    case "up":
      return "translate(0, -140%)";
    case "down":
      return "translate(0, 140%)";
  }
}
