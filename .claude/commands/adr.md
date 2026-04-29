---
description: Draft and append a new ADR to gateway/docs/decisions.md. Usage: /adr <short title>
argument-hint: <short title>
---

Invoke the `adr-author` skill with title `$ARGUMENTS`.

If `$ARGUMENTS` is empty, ask the user for the title first.

Before writing, confirm the user has actually made the decision (status=Accepted) — if it's still open, suggest using `Trạng thái: Proposed` instead and revisit later.
