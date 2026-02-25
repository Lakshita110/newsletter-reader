import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

function b64urlDecode(input: string) {
  // Gmail returns base64url (uses - and _). Convert to standard base64.
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, "base64").toString("utf-8");
}

function getHeader(headers: any[] | undefined, name: string) {
  const h = (headers || []).find(
    (x) => x?.name?.toLowerCase() === name.toLowerCase()
  );
  return h?.value ?? "";
}

function extractBodies(payload: any): { html?: string; text?: string } {
  // Gmail messages can be nested multipart. Walk the tree and grab text/plain + text/html.
  let html: string | undefined;
  let text: string | undefined;

  const walk = (part: any) => {
    if (!part) return;

    const mime = part.mimeType;
    const data = part.body?.data;

    if (data && (mime === "text/html" || mime === "text/plain")) {
      const decoded = b64urlDecode(data);
      if (mime === "text/html") html = html ?? decoded;
      if (mime === "text/plain") text = text ?? decoded;
    }

    if (Array.isArray(part.parts)) {
      for (const p of part.parts) walk(p);
    }
  };

  walk(payload);
  return { html, text };
}

export async function GET(req: Request) {
  // Reliable: parse id from the URL path
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[parts.length - 1]; // last segment

  if (!id) {
    return NextResponse.json({ error: "Missing id in path" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const accessToken = (session as any)?.accessToken as string | undefined;

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
  const headers = payload?.headers ?? [];

  const subject = getHeader(headers, "Subject");
  const from = getHeader(headers, "From");
  const date = getHeader(headers, "Date");

  const { html, text } = extractBodies(payload);

  return NextResponse.json({
    id: msg.data.id,
    threadId: msg.data.threadId,
    subject,
    from,
    date,
    snippet: msg.data.snippet,
    hasHtml: Boolean(html),
    hasText: Boolean(text),
    // For now we return the whole body so you can test.
    // Later we’ll store it in DB and sanitize before rendering.
    html,
    text,
  });
}