-- Drop the write-only rank eval log (nothing ever read it).
DROP TABLE IF EXISTS "RssRankEvalLog";

-- Drop the never-set subscription priority (frozen at NORMAL since launch).
ALTER TABLE "UserRssSubscription"
DROP COLUMN IF EXISTS "priority";

DROP TYPE IF EXISTS "RssPriority";

-- Drop the never-written RSS item content hash.
ALTER TABLE "RssItem"
DROP COLUMN IF EXISTS "contentHash";
