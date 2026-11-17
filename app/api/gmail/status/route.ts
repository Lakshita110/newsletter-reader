import { google } from "googleapis";
import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session-user";
import { getGmailAccessToken, getGmailStatus } from "@/lib/gmail-token";

export const dynamic = "force-dynamic";

/**
 * Whether new newsletters can be pulled from Gmail, and from which mailbox.
 * The mailbox is shown in Sources because "my newsletters are missing" is
 * often "the app is reading a different Google account".
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = await getGmailStatus(userId);
  let mailbox: string | null = null;
  if (status.connected) {
    const accessToken = await getGmailAccessToken(userId);
    if (accessToken) {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });
      try {
        const profile = await google.gmail({ version: "v1", auth }).users.getProfile({ userId: "me" });
        mailbox = profile.data.emailAddress ?? null;
      } catch (error) {
        console.warn("[gmail-status] could not read Gmail profile", error);
      }
    }
  }
  return NextResponse.json({ ...status, mailbox });
}
