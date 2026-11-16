/**
 * Warm the offline cache for the top of the queue. The service worker
 * (public/sw.js) stores every /api/feed/item response it sees, so simply
 * fetching them here is enough for them to open on the subway later.
 */
export async function prefetchForOffline(ids: string[], limit = 20, concurrency = 3) {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
  const queue = ids.slice(0, limit);
  const worker = async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) return;
      try {
        await fetch(`/api/feed/item/${encodeURIComponent(id)}`);
      } catch (error) {
        console.warn("[offline] prefetch failed", id, error);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}
