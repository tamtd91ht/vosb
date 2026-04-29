# vso — SMPP/Voice Gateway Platform

Aggregator gateway: nhận SMS từ đối tác qua SMPP server (port 2775) hoặc HTTP API, worker route theo cấu hình ra **3rd-party API** / **FreeSWITCH (voice OTP)** / **SMPP client tới telco**.

## Repo layout

- `smpp/backend/`  — Spring Boot 3 + jSMPP, Maven multi-module (`core`, `smpp-server`, `worker`)
- `smpp/frontend/` — Next.js 15 App Router (admin + portal trong cùng app)
- `smpp/nginx/`    — vhost + TLS config (Nginx chạy trên host server)
- `smpp/docs/`     — thiết kế chi tiết, **đọc trước khi code**
- `readme/`        — bản sao docs tiếng Việt có chú thích (chỉ tham khảo)
- `.ssh/`          — SSH private key tới server (KHÔNG commit)

## Stack & quyết định kiến trúc đã chốt

- **BE**: Spring Boot 3 (chỉ bootstrap/lifecycle/DI/config) + **Vert.x Web** (toàn bộ HTTP/REST), Java 21, jSMPP, Spring Data JPA + Flyway, Spring AMQP, Lettuce. **Không** dùng Spring MVC / `spring-boot-starter-web` — xem ADR-010 và `.claude/rules/vertx-rest.md`.
- **FE**: Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, NextAuth v5, TanStack Query
- **Hạ tầng** (đã sẵn): Postgres 16, Redis 7, RabbitMQ 3.13 trên Docker `infra-net`
- **Server prod**: Ubuntu 24.04 @ `116.118.2.74`, SSH user `tamtd`, key `D:\works\tkc-02\.ssh\tamtd`
- **Worker**: 2 service tách biệt (`smpp-server` + `worker`) chia sẻ `core` module
- **Routing**: theo `partner + msisdn_prefix` (priority + fallback)
- **Auth partner**: SMPP `system_id+password` (bcrypt) + API key (HMAC SHA-256 bearer)
- **DLR**: lưu DB + forward về partner (`deliver_sm` SMPP hoặc webhook HTTP)
- **Observability** phase 1: Spring Actuator + log file (chưa Prom/Grafana)

## Tiến độ implementation

**Source of truth**: `smpp/smpp-plan.md` — checklist 26 task (T01..T26) chia 5 milestone (M1-M5). Mỗi task có DoD + dependencies + note quirks gặp phải. Đầu file có section "🔁 Resume here" với snapshot trạng thái + verify commands + decisions log.

Khi vào session mới: **đọc `smpp/smpp-plan.md` trước** để biết task nào đang dở, env quirks gì cần lưu ý, rồi mới tiếp tục.

## Đọc theo thứ tự

1. `smpp/docs/infras.md`         — hạ tầng đã có sẵn (KHÔNG động vào)
2. `smpp/docs/architecture.md`   — sơ đồ tổng thể, flow message
3. `smpp/docs/backend.md`        — Maven module, SMPP server, worker, dispatcher
4. `smpp/docs/data-model.md`     — schema Postgres + Flyway plan
5. `smpp/docs/api.md`            — REST API spec (admin/portal/partner)
6. `smpp/docs/smpp-protocol.md`  — phần SMPP server inbound (bind/auth/PDU)
7. `smpp/docs/routing.md`        — RouteResolver + cache + fallback logic
8. `smpp/docs/dispatchers.md`    — 3 dispatcher (HTTP, ESL, SMPP client)
9. `smpp/docs/dlr-flow.md`       — DLR ingress + forward về partner
10. `smpp/docs/frontend.md`      — Next.js layout, auth, role guard
11. `smpp/docs/nginx.md`         — vhost, TLS, UFW, deploy
12. `smpp/docs/roadmap.md`       — phase 1→10 + Definition of Done
13. `smpp/docs/decisions.md`     — Architecture Decision Records

## `.claude/` — rules, agents, skills, commands

Cấu trúc khung trong `.claude/`:

```
.claude/
├── CLAUDE.md                          # file này
├── settings.json                      # permissions allow/deny + env
├── agents/                            # subagent definitions (Agent tool)
│   ├── smpp-protocol-expert.md        # jSMPP, PDU, bind/auth, DLR encoding
│   ├── vertx-rest-builder.md          # Vert.x Web router + handler
│   └── flyway-migration-author.md     # Flyway V*__*.sql
├── skills/                            # multi-step playbooks (Skill tool)
│   ├── adr-author/SKILL.md            # append ADR vào decisions.md
│   └── phase-doc-check/SKILL.md       # verify DoD của roadmap phase
├── commands/                          # slash command (/cmd)
│   ├── phase.md                       # /phase [N] — show phase status
│   └── adr.md                         # /adr <title> — draft ADR
└── rules/                             # rule snippet, refer từ trong code review/agent
    ├── vertx-rest.md                  # bắt buộc Vert.x cho REST
    ├── code-language.md               # English code, Vietnamese docs
    ├── server-safety.md               # SSH prod constraints
    └── phase-discipline.md            # phase-N DoD trước phase-N+1
```

Khi review code / khi agent làm task: ưu tiên đọc `rules/` tương ứng. Khi task khớp `description` của agent → dùng `Agent` tool với `subagent_type` đúng.

## Quy ước

- **Mã nguồn**: tên biến/class/comment bằng **tiếng Anh**.
- **Tài liệu** trong `smpp/docs/`: **tiếng Việt** (mục tiêu chính), giữ nguyên thuật ngữ kỹ thuật tiếng Anh (Postgres, RabbitMQ, dispatcher...).
- **Commit message**: tiếng Anh, theo conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, ...).
- Không commit secret hoặc `.env`. Mọi password/key đọc từ env vars.
- Khi gặp quyết định kiến trúc mới → cập nhật doc tương ứng + thêm 1 ADR mới vào `smpp/docs/decisions.md`.
- File JSON/YAML deploy luôn ưu tiên env vars override (`${VAR:-default}` trong compose; `${spring.profiles.active}` trong app).

## Server access

```
ssh -i D:\works\tkc-02\.ssh\tamtd tamtd@116.118.2.74
```

- Hạ tầng: `~/apps/infrastructure/` — đã chạy. KHÔNG touch trừ khi user yêu cầu.
- App stack: `~/apps/smpp-app/` — sẽ deploy ở phase 10.
- RabbitMQ Management UI: SSH tunnel `-L 15672:127.0.0.1:15672`, sau đó mở `http://localhost:15672`.

## Bot bị cấm (constraints)

- Không tạo file mới ngoài kế hoạch nếu chưa hỏi user.
- KHÔNG expose Postgres/Redis/RabbitMQ AMQP ra public (đã firewall, đừng đụng).
- KHÔNG expose `/actuator/*` qua Nginx public.
- KHÔNG sửa `smpp/docs/infras.md` (mô tả state hạ tầng đã chốt).
- KHÔNG chạy `docker compose down -v` (mất data).
- KHÔNG SSH chạy lệnh ghi/restart trên server prod nếu user chưa yêu cầu rõ ràng.
- KHÔNG tự ý chuyển port public (chỉ 80, 443, 2775 được expose theo plan).

## Khi không chắc

Nếu task vượt quá scope của 1 phase trong `roadmap.md`, hoặc đụng quyết định chưa có ADR → hỏi user trước thay vì tự quyết.
