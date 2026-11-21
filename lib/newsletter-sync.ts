import { google, gmail_v1 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { classifyNewsletter, getHeader } from "@/lib/newsletter-classifier";
import { parseFrom, normalizePublicationKey } from "@/lib/from-header";
import { extractBodies } from "@/lib/gmail-body";
import type { FeedItem } from "@/lib/rss-candidates";
import { pickLeadImage } from "@/lib/lead-image";
import { getGmailAccessToken } from "@/lib/gmail-token";
import {
  buildInboxQuery,
  buildSenderQuery,
  extractWebUrl,
  isPlatformSender,
  syncWindowStart,
} from "@/lib/newsletter-sync-helpers";

/** Don't hit Gmail more than once per this interval per mailbox. */
const MIN_SYNC_INTERVAL_MS = 2 * 60 * 1000;
/** Cap on message ids considered per sync; the rest are picked up next time. */
const MAX_IDS_PER_SYNC = 300;
const FETCH_CONCURRENCY = 8;
/** How many stored issues the inbox shows. */
const INBOX_ISSUE_LIMIT = 200;
const INBOX_ISSUE_DAYS = 90;

export type NewsletterSyncResult = {
  status: "synced" | "partial" | "skipped-recent" | "auth-error";
  added: number;
};

export type MailboxSyncResult = {
  accountId: string;
  email: string | null;
  status: NewsletterSyncResult["status"] | "no-token" | "error";
  added: number;
};

function gmailClient(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

function httpStatusOf(error: unknown): number | undefined {
  const e = error as { code?: number; status?: number; response?: { status?: number } };
  return e.response?.status ?? e.code ?? e.status;
}

async function listMessageIds(gmail: gmail_v1.Gmail, q: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 100, pageToken });
    for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < MAX_IDS_PER_SYNC);
  return ids.slice(0, MAX_IDS_PER_SYNC);
}

/**
 * Sync every connected mailbox for this user. Each mailbox is independent: a
 * disconnected or failing one is reported in its own result and doesn't stop
 * the others.
 */
export async function syncAllMailboxes(
  userId: string,
  opts: { timeBudgetMs?: number; force?: boolean } = {}
): Promise<MailboxSyncResult[]> {
  const accounts = await prisma.gmailAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, syncedAt: true },
  });
  const results: MailboxSyncResult[] = [];
  for (const account of accounts) {
    const accessToken = await getGmailAccessToken(account.id);
    if (!accessToken) {
      results.push({ accountId: account.id, email: account.email, status: "no-token", added: 0 });
      continue;
    }
    try {
      const result = await syncNewsletters(userId, account, accessToken, opts);
      results.push({ accountId: account.id, email: account.email, ...result });
    } catch (error) {
      console.error(`[newsletter-sync] mailbox ${account.id} failed`, error);
      results.push({ accountId: account.id, email: account.email, status: "error", added: 0 });
    }
  }
  return results;
}

/**
 * Copy new newsletter emails from one mailbox into NewsletterIssue.
 *
 * Why store instead of reading Gmail live (the old behavior): the live path
 * only saw the last few days of the INBOX label, so anything archived,
 * labeled, or older silently disappeared from the reader, and every inbox
 * load cost one Gmail call per message.
 *
 * Runs incrementally and within a time budget: if the budget runs out we
 * keep what was stored and leave the mailbox's `syncedAt` alone, so the next
 * call resumes (already-stored ids are skipped).
 */
export async function syncNewsletters(
  userId: string,
  account: { id: string; email: string | null; syncedAt: Date | null },
  accessToken: string,
  { timeBudgetMs = 8000, force = false }: { timeBudgetMs?: number; force?: boolean } = {}
): Promise<NewsletterSyncResult> {
  const startedAt = Date.now();
  if (!force && account.syncedAt && startedAt - account.syncedAt.getTime() < MIN_SYNC_INTERVAL_MS) {
    return { status: "skipped-recent", added: 0 };
  }

  const senders = await prisma.newsletterSender.findMany({
    where: { userId, isActive: true },
    select: { email: true },
  });
  const useSenderList = senders.length > 0;
  const windowStart = syncWindowStart(account.syncedAt);
  const q = useSenderList
    ? buildSenderQuery(
        senders.map((s) => s.email),
        windowStart
      )
    : buildInboxQuery(windowStart);

  const gmail = gmailClient(accessToken);
  let ids: string[];
  try {
    // A mailbox carried over from the single-mailbox days has no address
    // recorded yet; Settings needs it to tell mailboxes apart.
    if (!account.email) {
      const profile = await gmail.users.getProfile({ userId: "me" });
      if (profile.data.emailAddress) {
        await prisma.gmailAccount.update({
          where: { id: account.id },
          data: { email: profile.data.emailAddress.toLowerCase() },
        });
      }
    }
    ids = await listMessageIds(gmail, q);
  } catch (error) {
    const status = httpStatusOf(error);
    if (status === 401 || status === 403) {
      console.warn(`[newsletter-sync] Gmail auth error (${status}) for mailbox ${account.id}`);
      return { status: "auth-error", added: 0 };
    }
    throw error;
  }

  const existing = await prisma.newsletterIssue.findMany({
    where: { userId, gmailMessageId: { in: ids } },
    select: { gmailMessageId: true },
  });
  const existingIds = new Set(existing.map((row) => row.gmailMessageId));
  const pending = ids.filter((id) => !existingIds.has(id));

  let added = 0;
  let outOfTime = false;
  for (let i = 0; i < pending.length; i += FETCH_CONCURRENCY) {
    if (Date.now() - startedAt > timeBudgetMs) {
      outOfTime = true;
      break;
    }
    const batch = pending.slice(i, i + FETCH_CONCURRENCY);
    const rows = await Promise.all(batch.map((id) => fetchIssue(gmail, id, useSenderList)));
    const toStore = rows.filter((row): row is NonNullable<typeof row> => row !== null);
    if (toStore.length > 0) {
      const res = await prisma.newsletterIssue.createMany({
        data: toStore.map((row) => ({ ...row, userId })),
        skipDuplicates: true,
      });
      added += res.count;
    }
  }

  if (outOfTime) {
    console.info(`[newsletter-sync] partial: added=${added} remaining=${pending.length - added}`);
    return { status: "partial", added };
  }
  await prisma.gmailAccount.update({
    where: { id: account.id },
    data: { syncedAt: new Date(startedAt) },
  });
  await backfillLeadImages(userId);
  return { status: "synced", added };
}

async function fetchIssue(gmail: gmail_v1.Gmail, id: string, trustSenderList: boolean) {
  const msg = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  const headers = msg.data.payload?.headers;
  const subject = getHeader(headers, "Subject");
  const from = getHeader(headers, "From");
  const snippet = msg.data.snippet ?? "";

  const parsed = parseFrom(from);
  // Senders she listed, and newsletter platforms, are reads by definition;
  // the classifier only guards plain inbox mail in the no-sender-list mode.
  const trusted = trustSenderList || isPlatformSender(parsed.email || from);
  if (!trusted && !classifyNewsletter(headers, subject, from, snippet).isNewsletter) {
    return null;
  }

  const fromEmail = (parsed.email || from).toLowerCase();
  const { html, text } = extractBodies(msg.data.payload);
  const receivedAt = msg.data.internalDate
    ? new Date(Number(msg.data.internalDate))
    : new Date(getHeader(headers, "Date") || Date.now());

  return {
    gmailMessageId: id,
    threadId: msg.data.threadId ?? null,
    fromEmail,
    fromName: parsed.name,
    publicationKey: normalizePublicationKey(parsed.name),
    subject: subject || "(no subject)",
    snippet,
    receivedAt,
    html: html ?? null,
    // Plain text only matters when there is no HTML; otherwise the reader
    // text is extracted from the HTML (with Readability) on first open.
    text: html ? null : (text ?? null),
    webUrl: extractWebUrl(html),
    imageUrl: pickLeadImage(html) ?? "",
  };
}

/** Stored newsletter issues in the FeedItem shape the inbox renders. */
export async function getStoredNewsletterFeed(userId: string): Promise<FeedItem[]> {
  const since = new Date(Date.now() - INBOX_ISSUE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.newsletterIssue.findMany({
    where: { userId, receivedAt: { gte: since } },
    orderBy: { receivedAt: "desc" },
    take: INBOX_ISSUE_LIMIT,
    select: {
      gmailMessageId: true,
      fromEmail: true,
      fromName: true,
      publicationKey: true,
      subject: true,
      snippet: true,
      receivedAt: true,
      webUrl: true,
      imageUrl: true,
    },
  });
  return rows.map((row) => ({
    // Keep the bare Gmail id so existing read/save state keeps matching.
    id: row.gmailMessageId,
    sourceKind: "gmail" as const,
    subject: row.subject,
    from: `${row.fromName} <${row.fromEmail}>`,
    date: row.receivedAt.toISOString(),
    snippet: row.snippet ?? "",
    publicationName: row.fromName,
    publicationKey: row.publicationKey,
    externalUrl: row.webUrl ?? undefined,
    imageUrl: row.imageUrl || undefined,
  }));
}

/**
 * Rank senders seen in recent inbox mail that look like newsletters, so the
 * settings page can offer one-tap "add" instead of typing addresses.
 */
export async function suggestNewsletterSenders(accessTokens: string[], lookbackDays = 30) {
  const counts = new Map<string, { email: string; name: string; count: number; lastSubject: string }>();
  for (const accessToken of accessTokens) {
    await countNewsletterSenders(gmailClient(accessToken), lookbackDays, counts);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

async function countNewsletterSenders(
  gmail: gmail_v1.Gmail,
  lookbackDays: number,
  counts: Map<string, { email: string; name: string; count: number; lastSubject: string }>
) {
  const list = await gmail.users.messages.list({
    userId: "me",
    q: `newer_than:${lookbackDays}d -in:chats -in:spam -in:trash -category:promotions`,
    maxResults: 200,
  });
  const ids = (list.data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
  for (let i = 0; i < ids.length; i += FETCH_CONCURRENCY) {
    const batch = await Promise.all(
      ids.slice(i, i + FETCH_CONCURRENCY).map((id) =>
        gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "List-Id", "List-Unsubscribe", "Precedence", "Feedback-ID"],
        })
      )
    );
    for (const msg of batch) {
      const headers = msg.data.payload?.headers;
      const subject = getHeader(headers, "Subject");
      const from = getHeader(headers, "From");
      if (!classifyNewsletter(headers, subject, from, msg.data.snippet ?? "").isNewsletter) continue;
      const parsed = parseFrom(from);
      const email = parsed.email.toLowerCase();
      if (!email) continue;
      const prev = counts.get(email) ?? { email, name: parsed.name, count: 0, lastSubject: subject };
      prev.count += 1;
      counts.set(email, prev);
    }
  }
}

/**
 * Issues stored before lead images existed have imageUrl = null. Fill a
 * batch per sync from the HTML we already have (no Gmail calls), so photos
 * appear on older issues without a separate migration job.
 */
async function backfillLeadImages(userId: string, batch = 40) {
  const rows = await prisma.newsletterIssue.findMany({
    where: { userId, imageUrl: null },
    orderBy: { receivedAt: "desc" },
    take: batch,
    select: { id: true, html: true },
  });
  for (const row of rows) {
    await prisma.newsletterIssue.update({
      where: { id: row.id },
      data: { imageUrl: pickLeadImage(row.html) ?? "" },
    });
  }
}
