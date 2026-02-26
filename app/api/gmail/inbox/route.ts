import { google, gmail_v1 } from "googleapis";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { parseFrom, normalizePublicationKey } from "@/lib/email";

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  return (
    headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

function looksLikeNewsletter(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  subject: string,
  from: string,
  snippet: string
) {
  const listId = getHeader(headers, "List-Id");
  const listUnsub = getHeader(headers, "List-Unsubscribe");
  const listUnsubPost = getHeader(headers, "List-Unsubscribe-Post");
  const precedence = getHeader(headers, "Precedence");
  const xListId = getHeader(headers, "X-List-Id");
  const xList = getHeader(headers, "X-List");

  if (listId || listUnsub || listUnsubPost || xListId || xList) return true;
  if (/^(bulk|list|junk)$/i.test(precedence)) return true;

  const hay = `${subject} ${from} ${snippet}`.toLowerCase();
  const keywords =
    /(newsletter|digest|roundup|weekly|monthly|edition|issue|briefing|update|bulletin)/;
  const fromSignals = /(noreply|no-reply|newsletter|updates|digest|bulletin)/;
  const footerSignals = /(view in browser|unsubscribe|manage preferences)/;

  if (keywords.test(hay)) return true;
  if (fromSignals.test(hay)) return true;
  if (footerSignals.test(hay)) return true;

  return false;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const accessToken = session?.accessToken;

  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const list = await gmail.users.messages.list({
    userId: "me",
    q: "newer_than:30d",
    maxResults: 20,
  });

  const messages = list.data.messages ?? [];

  const results = await Promise.all(
    messages.map(async (message) => {
      const id = message.id;
      if (!id) return null;

      const fullMessage = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: [
          "Subject",
          "From",
          "Date",
          "List-Id",
          "List-Unsubscribe",
          "List-Unsubscribe-Post",
          "Precedence",
          "X-List-Id",
          "X-List",
        ],
      });

      const headers = fullMessage.data.payload?.headers;

      const subject = getHeader(headers, "Subject");
      const from = getHeader(headers, "From");
      const date = getHeader(headers, "Date");

      const parsed = parseFrom(from);
      const publicationName = parsed.name;
      const publicationKey = normalizePublicationKey(publicationName);

      if (!looksLikeNewsletter(headers, subject, from, fullMessage.data.snippet ?? "")) {
        return null;
      }

      return {
        id,
        subject,
        from,
        date,
        snippet: fullMessage.data.snippet,
        publicationName,
        publicationKey,
      };
    })
  );

  return NextResponse.json(results.filter(Boolean));
}
