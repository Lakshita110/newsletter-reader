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
  coveredBy?: { byId: string; publicationName: string; subject: string; matched: string[] };
};

export type FeedReadStatus = "unread" | "in-progress" | "read";
