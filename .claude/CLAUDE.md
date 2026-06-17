# Global working agreement

This file applies to every project. Project-level CLAUDE.md files add
specifics on top of this — they don't repeat it.

## Who's working with you

CS grad, comfortable writing code, learning agentic patterns deliberately
(not just trying to ship fast). Explain *why* when a decision isn't obvious,
not just what you did. Skip explaining things a CS grad already knows.

## Verification — lint and test by default

No test/lint setup exists yet in most of these projects. When you touch a
project that lacks one:
1. Set up a minimal linter and test runner appropriate to the stack (e.g.
   ruff + pytest for Python, eslint + vitest for JS) before or alongside the
   first real feature work — don't ask permission for this, just do it and
   say what you set up.
2. After that, lint and run tests after any non-trivial change, and fix
   failures before calling something done.
3. If a check can't reasonably exist yet (e.g. no clear pass/fail criteria),
   say so explicitly rather than silently skipping verification.

Show the actual output (test results, lint output) rather than asserting
"tests pass."

## Permissions — default to low-friction

Treat these as pre-approved, no need to ask:
- Reading files, running lint/test/build/typecheck commands
- git status / diff / log / add / commit (not push)
- Installing packages already implied by the task

Always ask first:
- git push, force-push, or any history rewrite
- Deleting files or dropping data
- Anything touching production config, secrets, deployment, billing, or
  external APIs that cost money or send real requests (e.g. live Notion
  workspace writes, real emails, real OpenRouter spend beyond trivial)
- Schema/migration changes to anything with real data in it

If unsure which bucket something falls into, ask.

## Context management — keep sessions clean

- If you've corrected the same mistake twice in one session, stop. Say so,
  suggest `/clear`, and propose a sharper restart prompt instead of trying a
  third time in the same polluted context.
- For any "go read/explore X" task that isn't trivially scoped to 1-2 files,
  use a subagent to do the exploration and report back, instead of reading
  everything into the main conversation.
- Before multi-file changes or anything where the approach isn't obvious,
  use plan mode: explore → plan → confirm → implement. Skip planning for
  single-file, single-purpose changes.
- Prefer `/compact <focus>` over generic auto-compact when a session is
  getting long but not done.

## Code style defaults

- Python: type hints on function signatures, f-strings, pathlib over
  os.path, dataclasses or pydantic over raw dicts for structured data.
- Prefer explicit over clever. Optimize for me being able to read this in
  six months, not for fewest lines.
- Comment *why*, not *what*, especially in code meant to teach a pattern
  (agent loops, routing logic, orchestration) — I'm often building these
  specifically to learn them.
- No silent fallbacks that swallow errors. Fail loudly or log clearly.

## Shell — I'm on PowerShell, not bash/zsh

Don't assume a Unix shell. Common mistakes to avoid:
- `curl` → PowerShell's `curl` is an alias for `Invoke-WebRequest` with
  different flags; it doesn't behave like real curl. Use
  `Invoke-WebRequest` (or `Invoke-RestMethod` for APIs/JSON) directly, or
  use `curl.exe` explicitly if you actually want real curl semantics.
- `ls -la`, `cat`, `rm -rf`, `export VAR=val`, `which` → these are aliases
  or don't exist. Use `Get-ChildItem`, `Get-Content`, `Remove-Item -Recurse
  -Force`, `$env:VAR = "val"`, `Get-Command` — or check what shell a given
  terminal/tool is actually running before assuming.
- Chaining commands: `&&` doesn't work the same way in older PowerShell.
  Use `;` to sequence, or check the PowerShell version before relying on
  `&&`/`||`.
- Env vars: `$env:NAME`, not `$NAME` or `%NAME%`.
- Path separators: prefer `Join-Path` or forward slashes (PowerShell
  accepts both) over hardcoded backslashes in generated code/scripts.
- If a tool/script is genuinely cross-platform (e.g. inside WSL, a
  Dockerfile, or a Python script), bash syntax is fine there — the
  restriction is about commands run directly in my terminal.

If you're unsure which shell a command will execute in, ask or check
before assuming bash syntax will work.

## Git / commits

- Don't commit unless asked, except as a natural checkpoint after a verified
  working change — ask once per session whether I want auto-commits at
  checkpoints, then follow that for the rest of the session.
- Commit messages: present tense, one line summary, body only if the why
  isn't obvious from the diff.

## When something's ambiguous

State the assumption you're making and proceed, rather than stopping to ask,
unless the cost of being wrong is high (data loss, money, irreversible
action) — then ask.