import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type SessionUser = {
  userId: string;
  email: string;
  /** Google OAuth access token from the NextAuth session, when present. */
  accessToken?: string;
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
  return { userId: user.id, email, accessToken: session?.accessToken };
}

/** Shorthand for the many routes that only need the user id. */
export async function getSessionUserId(): Promise<string | null> {
  return (await getSessionUser())?.userId ?? null;
}

export type SessionUserWithAccessToken = SessionUser & { accessToken: string };

/**
 * Like getSessionUser, but for the routes that call the Gmail API and need
 * a usable access token — returns null (routes answer that with a 401) when
 * signed in but the token is missing, e.g. after a failed refresh.
 */
export async function getSessionUserWithAccessToken(): Promise<SessionUserWithAccessToken | null> {
  const user = await getSessionUser();
  if (!user?.accessToken) return null;
  return { ...user, accessToken: user.accessToken };
}
