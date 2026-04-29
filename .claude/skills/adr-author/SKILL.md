---
name: adr-author
description: Append a new ADR to gateway/docs/decisions.md following the existing template. Use whenever the user makes an architecture decision worth recording (build tool, framework, security model, data layout, ...).
---

# ADR Author

Append-only workflow for `gateway/docs/decisions.md`.

## Steps

1. Read the trailing line of `decisions.md` (`## ADR mới sẽ append từ ADR-XXX trở đi.`) — that's your next free number.
2. Confirm the title with the user if not obvious from context.
3. Append a new ADR block right BEFORE the trailing pointer line, using this template:

```markdown
## ADR-NNN: <title>

- **Ngày**: YYYY-MM-DD
- **Trạng thái**: Accepted
- **Bối cảnh**: <1–2 sentences on the problem the team is solving>
- **Quyết định**: <the chosen approach, concrete>
- **Hệ quả**:
  - (+) <pro>
  - (+) <pro>
  - (−) <con>
- **Alternatives đã cân nhắc**:
  - <alt 1>: <why rejected>
  - <alt 2>: <why rejected>

---
```

4. Update the trailing pointer line to N+1.
5. Tell the user the ADR number so they can reference it in commits/PRs.

## Conventions

- Vietnamese prose, English technical terms (keep `Spring Boot`, `RabbitMQ`, `Vert.x`, ...).
- Status starts at `Accepted`. If superseding an older ADR, set the old one to `Superseded by ADR-NNN` in the SAME edit (the only allowed mutation of a past ADR).
- Date = today.
- Don't invent decisions the user hasn't actually made — if context is thin, ask 2–3 short questions before writing.
