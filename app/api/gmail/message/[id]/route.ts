import { google, gmail_v1 } from "googleapis";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { convert } from "html-to-text";

function b64urlDecode(input: string) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, "base64").toString("utf-8");
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  const header = headers?.find(
    (candidate) => candidate.name?.toLowerCase() === name.toLowerCase()
  );
  return header?.value ?? "";
}

function extractBodies(
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

function cleanTextLines(value: string): string {
  if (!value) return "";

  const lines = value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^https?:\/\/\S+$/i.test(line))
    .filter((line) => !/^(click here|read more|learn more|register|listen)$/i.test(line))
    .filter((line) => !/unsubscribe|privacy policy|terms\s*&\s*conditions/i.test(line));

  return lines.join("\n\n").trim();
}

function extractUsefulText({ html, text, snippet }: { html?: string; text?: string; snippet?: string }) {
  if (html) {
    const converted = convert(html, {
      wordwrap: false,
      preserveNewlines: true,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "noscript", format: "skip" },
        { selector: "head", format: "skip" },
      ],
    });

    const cleaned = cleanTextLines(converted);
    if (cleaned) return cleaned;
  }

  const cleanedText = cleanTextLines(text ?? "");
  if (cleanedText) return cleanedText;

  return (snippet ?? "").trim();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[parts.length - 1];

  if (!id) {
    return NextResponse.json({ error: "Missing id in path" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const accessToken = session?.accessToken;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not signed in or missing access token" },
      { status: 401 }
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const msg = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });

  const payload = msg.data.payload;
  const headers = payload?.headers;

  const subject = getHeader(headers, "Subject");
  const from = getHeader(headers, "From");
  const date = getHeader(headers, "Date");

  const { html, text } = extractBodies(payload);
  const extractedText = extractUsefulText({ html, text, snippet: msg.data.snippet ?? "" });

  return NextResponse.json({
    id: msg.data.id,
    threadId: msg.data.threadId,
    subject,
    from,
    date,
    snippet: msg.data.snippet,
    hasHtml: Boolean(html),
    hasText: Boolean(text),
    html,
    text: extractedText,
  });
}
