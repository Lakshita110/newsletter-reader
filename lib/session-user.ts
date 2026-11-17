import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getGmailAccessToken } from "@/lib/gmail-token";

export type SessionUser = {
  userId: string;
  email: string;
};

/**
 * Resolve the signed-in user for an API route, creating their row on first
 * request — accounts are provisioned lazily, there is no explicit sign-up.
 * Returns null when there is no session; routes answer that with a 401.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });
  return { userId: user.id, email };
}

/** Shorthand for the many routes that only need the user id. */
export async function getSessionUserId(): Promise<string | null> {
  return (await getSessionUser())?.userId ?? null;
}

export type SessionUserWithAccessToken = SessionUser & { accessToken: string };

/**
 * Like getSessionUser, but for the routes that call the Gmail API and need
 * a usable access token — returns null (routes answer that with a 401) when
 * signed in but Gmail isn't connected.
 */
export async function getSessionUserWithAccessToken(): Promise<SessionUserWithAccessToken | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const accessToken = await getGmailAccessToken(user.userId);
  return accessToken ? { ...user, accessToken } : null;
}
