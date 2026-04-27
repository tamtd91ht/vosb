---
description: Show roadmap phase status — Goal, files, DoD, dependencies. Usage: /phase [N]
argument-hint: [phase-number]
---

If `$ARGUMENTS` is empty: run `git log --oneline -10` and infer the most recently worked-on phase from commit messages + recently changed files. Otherwise use `$ARGUMENTS` as the phase number.

Then read `smpp/docs/roadmap.md` and print, for that phase:

- Header line (`## Phase N — ...`)
- Goal (1 line)
- File chính (bullet list)
- DoD (bullet list, with ✓/✗/? next to each item if you can quickly verify by reading filesystem)
- Smoke test snippet (verbatim code block)
- Dependencies

End with: "Run `phase-doc-check` skill for full automated verification."

Do NOT modify any files. This is a read-only status command.
