-- The rank-job lock was only used for on-demand (in-request) ranking, which
-- has been removed: the inbox now only ever reads the last snapshot cron
-- produced, so there's nothing left to lock.
DROP TABLE IF EXISTS "UserRssRankJobLock";
