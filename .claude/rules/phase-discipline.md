# Rule: Phase discipline

Project follow `smpp/docs/roadmap.md` — 10 phase tuần tự. Mỗi phase có Definition of Done (DoD) cứng.

## Quy tắc

- Phase `N` phải đạt 100% DoD trước khi bắt đầu code phase `N+1`.
- DoD verify được bằng `phase-doc-check` skill (đa số) hoặc smoke test thủ công (cho FreeSWITCH/SMPP partner thật).
- Khi gặp blocker giữa phase → ghi vào `smpp/docs/decisions.md` (ADR mới qua `adr-author` skill) HOẶC note tạm trong PR description.
- Khi quyết định chuyển phase, **commit + git tag**: `v0.<minor>-phase-<N>`.

## Khi user yêu cầu việc nằm ngoài phase hiện tại

- Nếu việc đó thuộc phase tương lai trong roadmap → cảnh báo user "việc này thuộc phase X, có muốn skip phase hiện tại không?" rồi đợi xác nhận.
- Nếu không thuộc phase nào (ad-hoc fix/refactor/doc) → vẫn làm, nhưng note trong commit message để dễ trace.

## Song song được

Theo roadmap:
- Phase 3 // Phase 4 (sau khi Phase 2 xong).
- Phase 5, 6, 7 // sau khi Phase 4 xong.
- Phase 8, 9 // với Phase 5–7 nếu có FE dev riêng.

Không được skip Phase 1 (skeleton) hoặc Phase 2 (schema + admin auth).
