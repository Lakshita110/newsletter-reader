/**
 * Runs before `next build` on Vercel (see the `vercel-build` script).
 *
 * Why this exists: Vercel's default build never touched the database, so new
 * Prisma migrations had to be applied by hand and a deploy could ship code
 * that queries tables that don't exist yet. Now production deploys migrate
 * first; if migrating fails, the build fails and Vercel keeps serving the
 * previous deployment, so prod is never left half-upgraded.
 *
 * Only production deploys migrate. Preview deploys (one per PR branch) must
 * not change the production schema just because a branch was pushed.
 *
 * Baseline case: if the database was originally created with `prisma db push`
 * it has tables but no _prisma_migrations history, and `migrate deploy`
 * refuses with P3005. Every migration dated before this change describes
 * schema the live app already runs on, so those are marked as applied
 * (not executed) and the newer ones are then applied normally.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

// Migrations at or after this prefix are new and must actually execute.
const FIRST_NEW_MIGRATION = "20261116000000";

function prisma(args) {
  console.log(`[vercel-migrate] prisma ${args.join(" ")}`);
  return execFileSync("npx", ["prisma", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function run(args) {
  try {
    const out = prisma(args);
    process.stdout.write(out);
    return { ok: true, output: out };
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    process.stdout.write(output);
    return { ok: false, output };
  }
}

if (process.env.VERCEL_ENV !== "production") {
  console.log(`[vercel-migrate] VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}: skipping migrations (production only).`);
  process.exit(0);
}

let result = run(["migrate", "deploy"]);
if (!result.ok && result.output.includes("P3005")) {
  const legacy = readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name < FIRST_NEW_MIGRATION)
    .map((d) => d.name)
    .sort();
  console.log(`[vercel-migrate] P3005: database has no migration history. Baselining ${legacy.length} existing migrations.`);
  for (const name of legacy) {
    const resolved = run(["migrate", "resolve", "--applied", name]);
    if (!resolved.ok) {
      console.error(`[vercel-migrate] could not baseline ${name}; aborting build.`);
      process.exit(1);
    }
  }
  result = run(["migrate", "deploy"]);
}

if (!result.ok) {
  console.error("[vercel-migrate] migrate deploy failed; failing the build so the previous deployment stays live.");
  process.exit(1);
}
console.log("[vercel-migrate] database is up to date.");
