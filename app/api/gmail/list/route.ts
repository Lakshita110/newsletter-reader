import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

export async function GET() {
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

  const q = "newer_than:30d";
  const res = await gmail.users.messages.list({
    userId: "me",
    q,
    maxResults: 10,
  });

  return NextResponse.json({
    query: q,
    count: res.data.messages?.length ?? 0,
    messages: res.data.messages ?? [],
  });
}