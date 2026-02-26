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
};

export function stripHtml(html: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ");
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
  return `${date} · ${time}`;
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
  if (node.type === "text") return node.data ?? "";
  if (!("children" in node) || !Array.isArray(node.children)) return "";
  return node.children.map(getNodeText).join(" ");
}
