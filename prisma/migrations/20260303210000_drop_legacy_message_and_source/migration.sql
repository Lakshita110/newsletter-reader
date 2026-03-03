-- Drop legacy newsletter storage tables no longer used by runtime flows.
DROP TABLE IF EXISTS "Message" CASCADE;
DROP TABLE IF EXISTS "Source" CASCADE;
