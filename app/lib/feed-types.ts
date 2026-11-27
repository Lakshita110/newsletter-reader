export type InboxItem = {
  id: string;
  sourceId?: string;
  sourceKind?: "gmail" | "rss" | "web";
  subject: string;
  from: string;
  date: string;
  snippet: string;
  publicationName: string;
  publicationKey: string;
  category?: string;
  isOverflow?: boolean;
  externalUrl?: string;
  imageUrl?: string;
  /** How many of her other sources run the same story (RSS only). */
  coverage?: number;
  coveredBy?: { byId: string; publicationName: string; subject: string; matched: string[] };
  /** Estimated minutes to read (newsletters only, lib/read-time.ts). */
  readMinutes?: number;
  /** An RSS post from a newsletter-style feed: shown with newsletters, never ranked (lib/longform.ts). */
  longform?: boolean;
  /** Other copies of the same newsletter issue (another mailbox or sender address), hidden. */
  duplicateIds?: string[];
};

export type FeedReadStatus = "unread" | "in-progress" | "read";
