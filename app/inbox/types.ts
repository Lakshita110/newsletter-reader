export type InboxItem = {
  id: string;
  sourceId?: string;
  sourceKind?: "gmail" | "rss";
  subject: string;
  from: string;
  date: string;
  snippet: string;
  publicationName: string;
  publicationKey: string;
  isOverflow?: boolean;
  externalUrl?: string;
};

export type FeedReadStatus = "unread" | "in-progress" | "read";

export type EnrichedInboxItem = InboxItem & {
  _date: Date | null;
  _dayKey: string;
};

export type GroupedInboxItems = {
  key: string;
  label: string;
  items: EnrichedInboxItem[];
};
