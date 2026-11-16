import type { gmail_v1 } from "googleapis";

function b64urlDecode(input: string) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, "base64").toString("utf-8");
}

/** Walk a MIME tree and return the first text/html and text/plain bodies. */
export function extractBodies(
  payload: gmail_v1.Schema$MessagePart | undefined
): { html?: string; text?: string } {
  let html: string | undefined;
  let text: string | undefined;

  const walk = (part: gmail_v1.Schema$MessagePart | undefined) => {
    if (!part) return;
    const mime = part.mimeType;
    const data = part.body?.data;
    if (data && (mime === "text/html" || mime === "text/plain")) {
      const decoded = b64urlDecode(data);
      if (mime === "text/html") html = html ?? decoded;
      if (mime === "text/plain") text = text ?? decoded;
    }
    if (Array.isArray(part.parts)) {
      for (const childPart of part.parts) walk(childPart);
    }
  };

  walk(payload);
  return { html, text };
}
