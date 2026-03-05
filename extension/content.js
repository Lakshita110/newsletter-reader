// Save current article to reader archive on Cmd+S (Mac) or Ctrl+S (Windows/Linux).
// Requires the user to be logged into the reader app in another tab (cookies are shared).

const DEFAULT_BASE_URL = "https://newsletter-reader-two.vercel.app";

document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key !== "s") return;

  // Don't intercept in text inputs
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;

  e.preventDefault();
  saveCurrentPage();
});

function extractPageContent() {
  const title = document.title.trim();

  const authorMeta =
    document.querySelector('meta[name="author"]') ??
    document.querySelector('meta[property="article:author"]') ??
    document.querySelector('meta[name="byl"]');
  const author = authorMeta?.getAttribute("content")?.trim() ?? "";

  // Prefer semantic article/main elements; fall back to body
  const contentEl =
    document.querySelector("article") ??
    document.querySelector('[role="main"]') ??
    document.querySelector("main") ??
    document.body;

  // Strip scripts/styles from clone before reading text
  const clone = contentEl.cloneNode(true);
  for (const el of clone.querySelectorAll("script, style, noscript, nav, footer, header")) {
    el.remove();
  }
  const text = clone.innerText.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  return { title, author, text };
}

function saveCurrentPage() {
  const { title, author, text } = extractPageContent();

  if (!text || text.length < 100) {
    showToast("Nothing to save (page text too short)");
    return;
  }

  chrome.storage.local.get(["readerBaseUrl"], (result) => {
    const baseUrl = (result.readerBaseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");

    fetch(`${baseUrl}/api/articles/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        url: location.href,
        title,
        text,
        author: author || undefined,
        source: location.hostname,
      }),
    })
      .then((res) => {
        if (res.ok) {
          showToast("Saved ✓");
        } else if (res.status === 401) {
          showToast("Not logged in — open your reader and sign in first");
        } else {
          showToast("Save failed");
        }
      })
      .catch(() => showToast("Save failed — check your connection"));
  });
}

function showToast(message) {
  const existing = document.getElementById("_reader-save-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "_reader-save-toast";
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    background: "#111",
    color: "#fff",
    padding: "10px 16px",
    borderRadius: "6px",
    fontSize: "14px",
    lineHeight: "1.4",
    zIndex: "2147483647",
    fontFamily: "system-ui, -apple-system, sans-serif",
    boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
    pointerEvents: "none",
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}
