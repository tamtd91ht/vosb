---
name: phase-doc-check
description: Verify the Definition-of-Done for a roadmap phase. Reads gateway/docs/roadmap.md, parses the DoD list of the requested phase, runs each smoke check it can automate, and reports a punch list. Read-only — never commits or modifies code.
---

# Phase DoD Check

## Inputs

- `phase` (1–10). If the user doesn't specify, infer from `git log --oneline -10` + the latest doc edits.

## Steps

1. Read `gateway/docs/roadmap.md`, locate `## Phase N — ...`.
2. Extract: `Goal`, `File chính`, `DoD`, `Smoke test`, `Dependencies`.
3. For each DoD bullet, classify it:
   - **Auto-checkable**: `./mvnw -B verify`, `docker compose ps`, `curl /actuator/health`, presence of files. Run it.
   - **Manual**: anything that needs a real partner client, FreeSWITCH softphone, real telco. Skip with `?`.
4. Render report:
   ```
   Phase N — <Goal>
   ✓ <DoD bullet>             — passed
   ✗ <DoD bullet>             — failed: <diagnostic>
   ? <DoD bullet>             — manual, run: <command/instruction>
   ```
5. End with a one-line verdict: `READY to advance to phase N+1` / `BLOCKED — fix ✗ items` / `MANUAL VERIFICATION REQUIRED`.

## Constraints

- Read-only. Never `git commit`, `mvn install`, `docker compose down`, or modify files.
- Don't SSH to the prod server (`116.118.2.74`) — DoD applies to local docker-compose stack.
- If a DoD bullet references files that don't exist yet, report `✗` with a clear "file missing" diagnostic.
