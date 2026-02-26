import DOMPurify from "isomorphic-dompurify";
import type { Element, Node } from "domhandler";

export type ReadMessage = {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  html?: string;
  text?: string;
  externalUrl?: string | null;
};

export function stripHtml(html: string): string {
  if (!html) return "";

  const fallback = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (typeof DOMParser === "undefined") {
    return fallback;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const body = doc.body;

  if (!body) {
    return fallback;
  }

  for (const selector of [
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "canvas",
    "meta",
    "link",
    "title",
    "head",
  ]) {
    doc.querySelectorAll(selector).forEach((node) => node.remove());
  }

  for (const node of Array.from(doc.querySelectorAll<HTMLElement>("*"))) {
    const classAndId = `${node.className ?? ""} ${node.id ?? ""}`.toLowerCase();
    const text = (node.textContent ?? "").toLowerCase();

    const isBoilerplate =
      /(footer|unsubscribe|social|share|banner|tracking|copyright)/.test(classAndId) ||
      /view in browser|view email online|unsubscribe|privacy policy|terms/.test(text);

    const isHidden =
      node.hasAttribute("hidden") ||
      node.getAttribute("aria-hidden") === "true" ||
      node.style?.display === "none" ||
      node.style?.visibility === "hidden";

    if (isBoilerplate || isHidden) node.remove();
  }

  doc.querySelectorAll("a").forEach((a) => {
    const anchorText = (a.textContent ?? "").trim();
    const href = (a.getAttribute("href") ?? "").trim();

    const isTrackingLink = /click\.|mailchi\.mp|utm_|doubleclick|tracking/i.test(href);
    const isBareUrlText = /^https?:\/\/\S+$/i.test(anchorText);

    if (!anchorText || (isTrackingLink && isBareUrlText)) {
      a.remove();
      return;
    }

    if (isTrackingLink && anchorText.length < 3) {
      a.remove();
    }
  });

  const raw = ("innerText" in body ? (body as HTMLElement).innerText : "") || body.textContent || "";
  const cleanedLines = raw
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^https?:\/\/\S+$/i.test(line))
    .filter((line) => !/^(click here|read more|learn more|register|listen)$/i.test(line))
    .filter((line) => !/unsubscribe|privacy policy|terms\s*&\s*conditions/i.test(line));

  return cleanedLines.join("\n\n").trim();
}

export function countWords(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const sameYear = parsed.getFullYear() === new Date().getFullYear();
  const date = parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const time = parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} - ${time}`;
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

export function cleanHtml(sanitized: string): string {
  if (!sanitized) return "";
  let html = sanitized;
  html = html.replace(/<head[\s\S]*?<\/head>/gi, "");
  html = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<(meta|link|title)[^>]*>/gi, "");
  html = html.replace(/\sstyle=(".*?"|'.*?'|[^\s>]+)/gi, "");
  html = html.replace(/\s(class|id)=(".*?"|'.*?'|[^\s>]+)/gi, "");
  return html;
}

export function shouldDropNode(node: Node): boolean {
  if (node.type !== "tag") return false;

  const tag = node as Element;
  const name = tag.name;
  const attribs = tag.attribs ?? {};
  const className = `${attribs.class ?? ""}`.toLowerCase();
  const id = `${attribs.id ?? ""}`.toLowerCase();
  const text = getNodeText(tag).toLowerCase();

  const classHit = /(social|share|follow|footer|icon-row|icons|banner)/.test(className);
  const idHit = /(social|share|follow|footer|icons|banner)/.test(id);
  const textHit = /view in browser|view online|open in browser|unsubscribe/.test(text);

  if (classHit || idHit || textHit) return true;

  if (name === "table" && /social|share|footer|icons/.test(text)) {
    return true;
  }

  return false;
}

function getNodeText(node: Node): string {
  if (node.type === "text") {
    const textNode = node as Node & { data?: string };
    return typeof textNode.data === "string" ? textNode.data : "";
  }
  if (!("children" in node) || !Array.isArray(node.children)) return "";
  return node.children.map(getNodeText).join(" ");
}

