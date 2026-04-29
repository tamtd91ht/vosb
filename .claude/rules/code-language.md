# Rule: Code in English, Docs in Vietnamese

- **Code** (tên biến/class/method/comment Java/TypeScript/SQL): tiếng Anh.
- **Tài liệu** trong `gateway/docs/`: tiếng Việt, giữ nguyên thuật ngữ kỹ thuật tiếng Anh (Spring Boot, Vert.x, RabbitMQ, dispatcher, route, partition, ...).
- **Commit message**: tiếng Anh, conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`).
- **PR description / review comment**: tiếng Việt (giải thích nội bộ team).
- **ADR**: tiếng Việt (xem template trong `gateway/docs/decisions.md`).
- **Log message**: tiếng Anh (sẽ ship sang Loki/Elastic, dễ tìm kiếm + grep).
- **Error message** trả về client (RFC 7807 `detail`): tiếng Anh — partner có thể là quốc tế.
- **UI string** trong frontend Next.js: tiếng Việt (admin/portal đều là người Việt).
