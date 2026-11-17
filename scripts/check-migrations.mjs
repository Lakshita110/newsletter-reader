/**
 * Fails if prisma/migrations doesn't produce exactly prisma/schema.prisma.
 *
 * Why: production schema changes now only happen through `migrate deploy`
 * (scripts/vercel-migrate.mjs). If someone edits schema.prisma and forgets
 * the migration, the build would ship code that queries columns production
 * never gets. This happened before (see the catch-up migration
 * 20261117010000), so CI enforces it.
 *
 * Needs SHADOW_DATABASE_URL: an empty, throwaway Postgres database that
 * Prisma replays the migrations into. Never point it at real data.
 */
import { spawnSync } from "node:child_process";

const shadow = process.env.SHADOW_DATABASE_URL;
if (!shadow) {
  console.error("[check-migrations] SHADOW_DATABASE_URL is not set (an empty throwaway Postgres database).");
  process.exit(1);
}

const result = spawnSync(
  "npx",
  [
    "prisma",
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--shadow-database-url",
    shadow,
    "--script",
    "--exit-code",
  ],
  { encoding: "utf8" }
);

// --exit-code: 0 = no difference, 2 = difference, anything else = error.
if (result.status === 0) {
  console.log("[check-migrations] migrations match schema.prisma.");
  process.exit(0);
}
if (result.status === 2) {
  console.error("[check-migrations] schema.prisma has changes with no migration. Missing SQL:\n");
  console.error(result.stdout);
  console.error("Create one with: npx prisma migrate dev --name <change>");
  process.exit(1);
}
console.error("[check-migrations] prisma migrate diff failed:\n", result.stdout, result.stderr);
process.exit(1);
