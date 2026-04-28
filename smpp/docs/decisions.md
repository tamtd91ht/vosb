# Architecture Decision Records (ADR)

File này append-only. Mỗi quyết định kiến trúc → 1 ADR mới. Không sửa ADR cũ; nếu thay đổi quyết định → ADR mới với trạng thái "Supersedes ADR-XXX" và update ADR cũ thành "Superseded by ADR-YYY".

Format chuẩn:

```
## ADR-NNN: <Tiêu đề>
- **Ngày**: YYYY-MM-DD
- **Trạng thái**: Accepted | Superseded by ADR-XXX | Deprecated
- **Bối cảnh**: <vấn đề cần quyết định>
- **Quyết định**: <chọn cái gì>
- **Hệ quả**: <tác động>
- **Alternatives đã cân nhắc**: <gạch đầu dòng>
```

---

## ADR-001: Tách 2 service `smpp-server` + `worker`

- **Ngày**: 2026-04-27
- **Trạng thái**: Accepted
- **Bối cảnh**: Backend cần làm 2 việc rất khác nhau: (a) accept SMPP bind từ partner + nhận HTTP request inbound; (b) consume queue → routing → dispatch ra ngoài (HTTP/ESL/SMPP client). Hai việc có pattern chịu tải khác nhau (a là I/O TCP keepalive, b là batch processing).
- **Quyết định**: Tách 2 Spring Boot app riêng (`smpp-server`, `worker`) trong cùng Maven multi-module repo, share `core` module (domain + repo + DTO).
- **Hệ quả**:
  - (+) Scale độc lập (worker chạy nhiều replica, smpp-server chạy ít hơn).
  - (+) Fault isolation: worker crash không ảnh hưởng SMPP session đang bind.
  - (+) Deploy độc lập (smpp-server có thể không restart khi worker update logic dispatcher).
  - (−) Phức tạp hơn 1 service: 2 Dockerfile, 2 entry, 2 healthcheck.
  - (−) Khi debug message flow phải nhìn cả 2 log.
- **Alternatives đã cân nhắc**:
  - 1 service multi-thread: đơn giản nhất nhưng scale ngang phải nhân bản cả 2 vai trò.
  - 3 service (`smpp-server` + `api` + `worker`): linh hoạt nhất nhưng overhead deploy quá lớn cho phase đầu.

---

## ADR-002: Spring Boot 3 + jSMPP

- **Ngày**: 2026-04-27
- **Trạng thái**: Accepted
- **Bối cảnh**: Cần chọn framework Java + thư viện SMPP. Yêu cầu: dev nhanh, doc nhiều, ổn định.
- **Quyết định**: Spring Boot 3.x (Java 21 LTS) + jSMPP `org.jsmpp:jsmpp:3.0.0+` cho cả SMPP server (inbound) và SMPP client (outbound tới telco).
- **Hệ quả**:
  - (+) Hệ sinh thái Spring (Data JPA, AMQP, Security, Actuator) tích hợp sẵn, ít boilerplate.
  - (+) jSMPP API trực quan, được dùng nhiều ở VN, nhiều ví dụ.
  - (+) Java 21 virtual threads → handle nhiều SMPP session concurrent rẻ hơn.
  - (−) jSMPP không hot/async bằng Cloudhopper (Netty); throughput cực cao có thể gặp bottleneck.
- **Alternatives đã cân nhắc**:
  - Cloudhopper-smpp: hiệu năng cao hơn nhưng ít doc + phức tạp hơn.
  - Quarkus + jSMPP: startup nhanh, RAM thấp nhưng dev experience khác Spring, team chưa quen.

---

## ADR-003: 1 Next.js app multi-role (vs 2 app monorepo)

- **Ngày**: 2026-04-27
- **Trạng thái**: Accepted
- **Bối cảnh**: Cần FE cho cả admin (operator nội bộ) và portal (partner xem traffic của họ). Hai role có UI khác biệt nhưng nhiều component có thể share (data table, form, layout).
- **Quyết định**: 1 Next.js 15 codebase. Sau login, role admin → `/admin/*`, role partner → `/portal/*`. 1 Dockerfile, 1 container, 1 host trên Nginx.
- **Hệ quả**:
  - (+) Share component dễ qua import trực tiếp, không cần workspace.
  - (+) 1 build, 1 deploy, đơn giản hóa CI.
  - (+) Tiết kiệm RAM server (1 Node runtime thay 2).
  - (−) Bundle FE đẩy về client lớn hơn (cả admin + portal code lẫn lộn). Có thể giảm bằng route-based code-splitting (Next.js làm sẵn).
  - (−) Bug ở admin có thể ảnh hưởng portal nếu share component bị regression.
- **Alternatives đã cân nhắc**:
  - 2 Next.js app trong pnpm monorepo: tách bạch rõ, deploy riêng nhưng overhead thiết lập + 2 container.
  - Vite + React SPA: nhẹ nhất, nhưng mất SSR (admin tool ít cần SEO, vẫn OK), team chọn Next vì familiar hơn.

---

## ADR-004: FreeSWITCH tích hợp qua ESL TCP

- **Ngày**: 2026-04-27
- **Trạng thái**: Accepted
- **Bối cảnh**: Voice OTP yêu cầu originate call + playback TTS. Cần biết kết quả call (answered/no answer/busy) realtime để mark state.
- **Quyết định**: Worker dùng `org.freeswitch.esl.client` (Java ESL client) kết nối ESL inbound TCP tới FreeSWITCH host. Lệnh `bgapi originate` + listen event `CHANNEL_HANGUP_COMPLETE` để map state.
- **Hệ quả**:
  - (+) Latency thấp (TCP keepalive, không HTTP polling).
  - (+) Nhận event realtime, biết ngay kết quả call.
  - (+) Control đầy đủ: dialplan inline, variable per-call.
  - (−) Cần mở port ESL (mặc định 8021) giữa worker và FS host. Nếu ở khác mạng cần VPN/firewall rule.
  - (−) Library ESL Java khá cũ, ít maintain. Có thể phải fork/patch.
- **Alternatives đã cân nhắc**:
  - REST API qua `mod_xml_rpc`: đơn giản hơn nhưng không nhận event, phải poll.
  - Asterisk AMI thay FS: stack khác, không trong kế hoạch.

---

## ADR-005: Routing theo partner + msisdn_prefix (vs full rule engine)

- **Ngày**: 2026-04-27
- **Trạng thái**: Accepted
- **Bối cảnh**: Cần engine routing để mỗi partner có thể đẩy SMS đi nhiều channel khác nhau dựa trên đích.
- **Quyết định**: Schema đơn giản: bảng `route(partner_id, msisdn_prefix, channel_id, priority, fallback_channel_id)`. Match theo longest-prefix với dest_addr (đã normalize). Priority tie-break.
- **Hệ quả**:
  - (+) Dễ hiểu, dễ debug, query nhanh (index trên `partner_id, msisdn_prefix`).
  - (+) Đủ cho ~90% use case thực tế (route theo nhà mạng đích).
  - (−) Không hỗ trợ rule phức tạp: thời gian, sender_id, content keyword, A/B split.
  - (−) Khi cần rule phức tạp phải migrate sang engine mới (vd Drools, OPA).
- **Alternatives đã cân nhắc**:
  - Full rule engine (condition tree, JSON DSL): linh hoạt nhưng phức tạp + UI admin khó.
  - 1 partner = 1 channel cứng: đơn giản hóa quá đà, không split traffic được.

---

## ADR-006: Auth partner inbound — SMPP password + HTTP API key HMAC

- **Ngày**: 2026-04-27
- **Trạng thái**: Accepted
- **Bối cảnh**: Cần xác thực partner khi: (a) bind SMPP, (b) gọi HTTP API.
- **Quyết định**:
  - SMPP: `system_id` + `password` (theo chuẩn SMPP 3.4). Password lưu **bcrypt hash** trong `partner_smpp_account`. IP whitelist optional.
  - HTTP: API key gồm `key_id` (clear) + `secret` (chỉ show 1 lần khi tạo). Mỗi request gửi `X-Api-Key`, `X-Timestamp`, `X-Signature = HMAC-SHA256(secret, METHOD + PATH + TIMESTAMP + BODY)`. Replay protection: timestamp ±5 phút.
- **Hệ quả**:
  - (+) SMPP auth tuân chuẩn, partner dùng client SMPP nào cũng OK.
  - (+) HMAC chống MITM tampering kể cả khi không có TLS (TLS vẫn bắt buộc, đây là defense in depth).
  - (+) Rotate key đơn giản: tạo key mới + revoke key cũ.
  - (−) Partner phải implement HMAC sign client-side (không phải plain bearer token).
  - (−) Lưu bcrypt nghĩa là verify password mỗi bind có overhead CPU. Mitigate: cache hash result trong Redis 5p sau verify thành công.
- **Alternatives đã cân nhắc**:
  - OAuth2 client credentials: chuẩn enterprise nhưng thừa phức tạp; SMPP vẫn phải dùng password riêng dù sao.
  - mTLS: an toàn nhất nhưng overhead onboard partner cao (cấp/rotate cert).

---

## ADR-007: DLR — lưu DB + forward về partner (vs chỉ pull)

- **Ngày**: 2026-04-27
- **Trạng thái**: Accepted
- **Bối cảnh**: Khi telco trả DLR, partner cần biết kết quả gửi để cập nhật hệ thống của họ.
- **Quyết định**: Mọi DLR lưu vào bảng `dlr` (giữ history nhiều record/message). Sau khi lưu:
  - Nếu partner có SMPP session active → gửi `deliver_sm` (DLR PDU) trong session đó.
  - Nếu partner cấu hình `dlr_webhook` → HTTP request (method + custom headers từ config) tới URL đó (retry 30s/2m/10m, max 3). Xem ADR-013.
  - Nếu cả 2 không có → giữ DB, partner pull qua `GET /api/v1/messages/{id}`.
- **Hệ quả**:
  - (+) Realtime cho partner — chuẩn ngành SMS.
  - (+) Webhook fallback giúp partner không cần luôn online qua SMPP.
  - (−) Phải xử lý retry webhook (queue riêng `dlr.forward.retry`).
  - (−) Forward order không guarantee strict (parallel consumer).
- **Alternatives đã cân nhắc**:
  - Chỉ lưu DB, partner pull: đơn giản nhưng partner không nhận realtime, không khả thi cho voice OTP.
  - Kafka/RabbitMQ event stream cho partner subscribe: hiện đại nhưng overhead onboard quá lớn.

---

## ADR-008: Phase 1 observability — Spring Actuator + log file

- **Ngày**: 2026-04-27
- **Trạng thái**: Accepted
- **Bối cảnh**: Cần monitoring nhưng không muốn setup phức tạp ngay từ đầu.
- **Quyết định**: Phase 1 dùng Spring Boot Actuator (`/actuator/health`, `/actuator/metrics`) + log file. Logback rolling daily file appender, JSON format. **KHÔNG** setup Prometheus/Grafana/Loki phase này.
- **Hệ quả**:
  - (+) Setup nhanh, ít moving parts.
  - (+) Actuator JSON metrics đủ cho debug và scrape sau này.
  - (+) Log JSON format → khi cần Loki/Elastic chỉ ship file là xong.
  - (−) Không có dashboard realtime cho ops.
  - (−) Alert phải làm thủ công (vd cron grep log).
- **Alternatives đã cân nhắc**:
  - Prom + Grafana ngay phase 1: tốt nhưng team đang ưu tiên function trước.
  - Full stack OTel (Prom + Loki + Tempo): phù hợp khi production thật.

---

## ADR-009: Build tool — Maven (vs Gradle)

- **Ngày**: 2026-04-27
- **Trạng thái**: Accepted
- **Bối cảnh**: Cần chọn build tool cho backend Spring Boot multi-module. Trước đó doc draft ghi Gradle nhưng chưa có code; team cần chốt trước khi scaffold Phase 1.
- **Quyết định**: Dùng **Maven** (Maven Wrapper `mvnw`/`mvnw.cmd`) cho backend. Parent POM kế thừa `spring-boot-starter-parent`. Module: `core` (jar thường), `smpp-server`, `worker` (apply `spring-boot-maven-plugin` để repackage executable jar).
- **Hệ quả**:
  - (+) Spring Boot ecosystem có `spring-boot-starter-parent` quản version sẵn — ít cần khai báo `<dependencyManagement>` thủ công.
  - (+) IDE (IntelliJ, VS Code) hỗ trợ Maven multi-module ổn định, ít cần Kotlin DSL plugin.
  - (+) Cú pháp khai báo XML rõ ràng, dễ review trong code review (so với DSL Groovy/Kotlin của Gradle).
  - (+) Đa số ví dụ Spring Boot + jSMPP + Flyway trên mạng dùng Maven → giảm friction khi tham khảo.
  - (−) Build chậm hơn Gradle ở dự án rất lớn; ở quy mô 3 module hiện tại không phải vấn đề.
  - (−) Không có version catalog kiểu `libs.versions.toml`; thay bằng `<properties>` + `<dependencyManagement>` ở parent POM.
- **Alternatives đã cân nhắc**:
  - Gradle (Kotlin DSL) + version catalog: build nhanh hơn, DSL mạnh hơn, nhưng team ít quen DSL Kotlin và phải maintain `gradle/libs.versions.toml` riêng.
  - sbt/Bazel: ngoài scope, không phù hợp ecosystem Java/Spring Boot tiêu chuẩn.

---

## ADR-010: Vert.x Web cho REST, Spring Boot chỉ giữ vòng đời / DI / config

- **Ngày**: 2026-04-27
- **Trạng thái**: Accepted (phần "Actuator chạy ở port phụ 8081 qua Jetty" superseded bởi ADR-011 — 2026-04-27)
- **Bối cảnh**: Backend cần expose ~30 REST endpoint (partner inbound, admin, portal, internal webhook). Spring MVC + Tomcat blocking model thread-per-request kém hiệu quả khi có một số endpoint chờ I/O lâu (HTTP gọi 3rd-party, ESL inbound). Đồng thời team muốn giữ Spring Boot ecosystem (Data JPA, AMQP listener, Flyway, Actuator, `@ConfigurationProperties`).
- **Quyết định**:
  - HTTP/REST layer: **Vert.x Web** (`io.vertx:vertx-web`). Mọi endpoint là Vert.x `Handler<RoutingContext>`, mount vào sub-router theo path prefix (`/api/v1/*`, `/api/admin/*`, `/api/portal/*`, `/api/internal/*`).
  - Spring Boot chỉ làm: `@SpringBootApplication`, bean lifecycle (`@Component/@Service/@Repository/@Configuration`), DI, `@ConfigurationProperties`, Spring Data JPA, Spring AMQP, Flyway, Actuator (qua HTTP server riêng — xem hệ quả).
  - Auth = Vert.x `AuthenticationHandler` per sub-router. **Không** dùng `SecurityFilterChain` / `HttpSecurity`.
  - Outbound HTTP gọi 3rd-party = `io.vertx.ext.web.client.WebClient`. **Không** dùng Spring `RestTemplate`/`WebClient` (WebFlux).
  - Blocking work (JPA, JDBC, jSMPP submit) chạy trên `vertx.executeBlocking(...)` hoặc inject `@Service` chạy thread-pool riêng.
  - **Actuator**: chạy `spring-boot-starter-actuator` ở **management.server.port=8081** (loopback only) qua `spring-boot-starter-jetty` minimal — port chính 8080 vẫn là Vert.x. Nginx KHÔNG forward 8081 ra public.
- **Hệ quả**:
  - (+) Event loop Vert.x xử lý connection nhiều hơn với cùng RAM (đặc biệt khi DLR webhook fan-out).
  - (+) Code handler ngắn, ít magic, dễ test bằng `vertx-junit5` + `WebClient`.
  - (+) Tách rạch ròi 2 thế giới: Spring container (DI, AMQP listener, JPA tx) và Vert.x event loop (HTTP). Bug ở 1 bên không lan sang bên kia qua filter chain phức tạp.
  - (−) Lập trình viên phải hiểu rõ "không block event loop" — dễ bug nếu lỡ gọi JPA trực tiếp trong handler.
  - (−) Cần 2 HTTP server (8080 cho Vert.x, 8081 cho Actuator/Jetty). Dockerfile expose 1 port public, healthcheck dùng 8081 internal.
  - (−) Mất một số convenience của Spring MVC: `@Valid`, `@ControllerAdvice`, content negotiation tự động — phải tự viết qua Vert.x JSON Schema validator + 1 `failureHandler` chung.
- **Alternatives đã cân nhắc**:
  - **Spring MVC + Tomcat (mặc định)**: dễ nhất, ecosystem lớn nhất, nhưng blocking model phí RAM khi có nhiều endpoint I/O-bound. Reject vì priority project là throughput.
  - **Spring WebFlux + Netty**: reactive, non-blocking, ở trong ecosystem Spring. Reject vì WebFlux + JPA blocking là combo phức tạp (phải bridge Mono ↔ blocking), team chưa quen reactive operator.
  - **Quarkus + RESTEasy Reactive**: native compile nhanh, performance tốt nhưng thay toàn bộ DI container, ADR-002 đã chốt Spring Boot — đảo ngược quá lớn.
  - **Micronaut + Netty**: tương tự Quarkus, lý do reject như trên.

---

## ADR-011: Health/readiness endpoint qua Vert.x — không dùng Spring Boot Actuator

- **Ngày**: 2026-04-27
- **Trạng thái**: Accepted (supersedes phần Actuator của ADR-010)
- **Bối cảnh**: ADR-010 đề xuất chạy Spring Boot Actuator ở port phụ 8081 qua Jetty embedded để có `/health`, `/metrics`, `/info` builtin. Khi lập kế hoạch implement Phase 1 (xem `smpp/smpp-plan.md` T03/T04), có 2 lý do reconsider: (1) cần thêm `spring-boot-starter-jetty` + `spring-boot-starter-actuator` chỉ để có 1 endpoint health — overhead dependency lớn; (2) Spring Boot 3.3 management server với `management.server.port != server.port` cần servlet container, dễ leak vào main app khi project KHÔNG có `spring-boot-starter-web`.
- **Quyết định**:
  - **KHÔNG** dùng Spring Boot Actuator. KHÔNG thêm `spring-boot-starter-actuator`, KHÔNG thêm `spring-boot-starter-jetty`.
  - Tự code 2 endpoint qua Vert.x Web (cùng port 8080 với HTTP API chính, mount tại root, ngoài 4 sub-router business):
    - `GET /healthz` — ping DB (`SELECT 1`), Redis (`PING`), RabbitMQ (`Channel.isOpen()`). Trả 200 `{db,redis,rabbit:UP}` hoặc 503 nếu bất kỳ component DOWN. Implement ở T04 (`http/health/HealthHandlers.java`).
    - `GET /readyz` — flag `applicationReady` set bởi listener `ApplicationReadyEvent`. Trả 200 nếu app đã warmup, 503 nếu chưa.
  - Nginx **block** `/healthz` ra public; `/readyz` có thể expose cho load balancer probe.
- **Hệ quả**:
  - (+) Giảm 2 dependency (`actuator` + `jetty`), giảm RAM ~20-30 MB, giảm 1 HTTP server.
  - (+) Health logic tường minh — đọc code thay vì dò tài liệu Actuator + endpoint exposure.
  - (+) Không có endpoint metadata Spring (env, beans, configprops) — giảm rủi ro leak.
  - (−) Mất `/actuator/metrics`, `/actuator/info`, `/actuator/threaddump`, ... — phase observability sau cần tự thêm Micrometer Prometheus registry bare (không qua actuator).
  - (−) Phải tự maintain logic check DB/Redis/Rabbit; lỗi check sai có thể mask bug.
- **Alternatives đã cân nhắc**:
  - Giữ Actuator + Jetty 8081 (ADR-010 nguyên gốc): đầy đủ endpoint, nhưng overhead dependency + 1 HTTP server thừa cho phase đầu.
  - Actuator qua WebFlux + Netty 8081: 2 reactive runtime trong 1 JVM (Vert.x + Netty Reactor) — phức tạp.
  - Actuator standalone JMX (không HTTP): mất khả năng HTTP probe cho Docker healthcheck.

---

## ADR-012: Lưu API key secret bằng AES-GCM-256 (không phải bcrypt)

- **Ngày**: 2026-04-28
- **Trạng thái**: Accepted
- **Bối cảnh**: `partner_api_key` cần lưu secret để xác thực HMAC. Phương án đầu (`secret_hash bcrypt`) không cho phép recover plaintext — khi partner mất secret, admin phải revoke key và tạo key mới, không thể hiển thị lại. Yêu cầu nghiệp vụ: admin có thể recover secret cho partner nếu cần (controlled access).
- **Quyết định**: Lưu `secret_encrypted BYTEA` + `nonce BYTEA` (AES-GCM-256, nonce 12 bytes random mỗi lần encrypt). Key đọc từ env `APP_SECRET_KEY` (32 bytes). Implement trong `core/security/SecretCipher.java`. Schema: `partner_api_key(secret_encrypted, nonce)` thay cho `secret_hash VARCHAR`.
- **Hệ quả**:
  - (+) Admin có thể decrypt để recover secret khi partner yêu cầu (controlled).
  - (+) AES-GCM cung cấp authenticated encryption — phát hiện tamper.
  - (+) Key rotation: đổi `APP_SECRET_KEY` → re-encrypt tất cả secret (1 migration batch).
  - (−) Nếu `APP_SECRET_KEY` bị lộ, toàn bộ secret bị compromise — phải bảo vệ key ở env/secret manager.
  - (−) Phức tạp hơn bcrypt: cần quản lý nonce, không thể dùng với hashing thông thường.
- **Alternatives đã cân nhắc**:
  - `bcrypt(secret)`: không reversible, không thể recover — loại vì yêu cầu nghiệp vụ.
  - Vault (HashiCorp) transit encryption: an toàn nhất nhưng dependency nặng, ngoài scope Phase 2.
  - `pgcrypto` PG server-side encrypt: key nằm trong DB config — attack vector tương đương.

---

## ADR-013: DLR webhook config dùng JSONB trên bảng partner (không phải flat columns hay bảng riêng)

- **Ngày**: 2026-04-28
- **Trạng thái**: Accepted
- **Bối cảnh**: Partner cần cấu hình webhook endpoint để nhận DLR notification (khi không có SMPP session active). Hiện tại chỉ có `dlr_webhook_url VARCHAR(512)`. Yêu cầu bổ sung: custom HTTP headers (Authorization, X-Api-Key, ...) + method (default POST).
- **Quyết định**: Thay `dlr_webhook_url VARCHAR` bằng `dlr_webhook JSONB` với cấu trúc `{url, method, headers}`. `NULL` = chưa cấu hình webhook. Nhất quán với `channel.config JSONB` pattern đã có.
- **Hệ quả**:
  - (+) Atomic: `dlr_webhook IS NULL` thay 3 cột NULL riêng — query đơn giản hơn.
  - (+) Flexible: thêm `timeout_ms`, `retry_policy` sau không cần migration schema.
  - (+) Nhất quán với `channel.config` — codebase có 1 pattern JSONB config.
  - (−) Không có DB constraint trên cấu trúc nội bộ JSON — validate ở application layer.
  - (−) Khó index trên `dlr_webhook->>'url'` nếu cần search theo URL.
- **Alternatives đã cân nhắc**:
  - Flat columns (`dlr_webhook_url`, `dlr_webhook_method`, `dlr_webhook_headers JSONB`): dễ constraint nhưng 3 cột NULL riêng, clutters partner table, khó extend.
  - Bảng `partner_webhook` riêng: hỗ trợ nhiều webhook type (DLR, balance alert, ...) nhưng over-engineered cho Phase 2; có thể migrate sau nếu cần.

---

## ADR-014: HTTP Provider Adapter Pattern — hardcode adapter theo nhà cung cấp thay vì cấu hình động hoàn toàn

- **Ngày**: 2026-04-28
- **Trạng thái**: Accepted
- **Bối cảnh**: `channel.type = HTTP_THIRD_PARTY` cho phép gửi SMS/Voice OTP qua HTTP API của bên thứ ba (eSMS, Abenla, Vietguys, SpeedSms, Infobip, Stringee, ...). Mỗi nhà cung cấp có endpoint, request format, cơ chế auth và cấu trúc response khác nhau. Cần quyết định approach:
  - **Option A — Fully dynamic**: ops nhập toàn bộ URL, HTTP method, body template (FreeMarker), headers, auth cấu hình tự do vào JSONB config.
  - **Option B — Hardcode adapter**: mỗi nhà cung cấp có 1 `HttpProviderAdapter` riêng trong code; ops chỉ điền credentials (API key, token, ...) thông qua form tự mô tả.
- **Quyết định**: **Option B — Provider Adapter Pattern**, kết hợp 1 `CUSTOM` adapter fallback cho nhà cung cấp chưa được hỗ trợ.
  - Interface `HttpProviderAdapter` với methods: `providerCode()`, `providerName()`, `deliveryType()`, `fields() → List<ProviderField>`.
  - `HttpProviderRegistry` collect tất cả adapter qua Spring DI, expose `GET /api/admin/channels/http-providers` trả metadata tự mô tả.
  - FE render dynamic form dựa trên `fields` (type: text/password/url/select/textarea).
  - Adapter hiện có: `ESmsAdapter`, `AbenlaAdapter`, `VietguysAdapter`, `SpeedSmsAdapter`, `InfobipAdapter`, `StringeeAdapter` (VOICE_OTP), `CustomHttpAdapter`.
- **Hệ quả**:
  - (+) UX vận hành đơn giản — ops chỉ chọn provider từ dropdown, điền credentials, không nhập URL/method/body thủ công.
  - (+) Dispatch logic worker chuẩn hóa theo provider code — dễ test, dễ debug, ít lỗi format request.
  - (+) Tự mô tả: FE không cần biết trước form của từng provider — đọc từ metadata API.
  - (+) `CUSTOM` adapter vẫn hỗ trợ ops linh hoạt nhập FreeMarker body template khi cần.
  - (−) Thêm nhà cung cấp mới = deploy code mới (không config-only). Chấp nhận được: số provider ổn định, mỗi lần thêm cần QA dispatch logic dù sao.
  - (−) Mỗi adapter cần maintain riêng khi provider thay đổi API — thực tế ít xảy ra với provider lớn.
- **Alternatives đã cân nhắc**:
  - Option A fully dynamic: linh hoạt nhất nhưng UX tệ (ops phải biết format body template của từng provider), dễ cấu hình sai, dispatch logic worker không thể tối ưu theo provider.
  - Plugin JAR hot-reload (OSGi/ServiceLoader): provider adapter là jar riêng, deploy không restart — overkill cho quy mô hiện tại.

---

## ADR-015: Hybrid Carrier Pricing — nội địa theo nhà mạng, quốc tế theo prefix

- **Ngày**: 2026-04-28
- **Trạng thái**: Accepted
- **Bối cảnh**: Bảng giá ban đầu (V2) dùng longest-prefix match trên `prefix VARCHAR`. Khi cần định giá theo nhà mạng nội địa Việt Nam, ops phải nhập thủ công 12 prefix Viettel, 8 prefix Mobifone, 8 prefix Vinaphone,... Vừa tốn công, vừa dễ bỏ sót khi MIC cấp đầu số mới. Ba phương án:
  - **Option A — Prefix-only**: giữ nguyên, ops nhập đủ prefix. Không scale về ops.
  - **Option B — Carrier-only**: bỏ prefix, chỉ lookup theo carrier. Không hỗ trợ giá quốc tế.
  - **Option C — Hybrid**: nội địa → match theo `carrier`; quốc tế/catch-all → match theo `prefix` như cũ.
- **Quyết định**: **Option C — Hybrid**, implement bằng cột `carrier VARCHAR(20) NULLABLE` trên `channel_rate` và `partner_rate`:
  - `carrier IS NOT NULL` → giá nội địa, match theo tên nhà mạng (`VIETTEL`, `MOBIFONE`, `VINAPHONE`, `VIETNAMOBILE`, `GMOBILE`, `REDDI`).
  - `carrier IS NULL` → giá quốc tế hoặc catch-all, match theo `prefix` (longest-prefix match như cũ). `prefix = ''` = catch-all.
  - Bảng `carrier_prefix` (V3) ánh xạ 4 chữ số đầu E.164 → tên nhà mạng (seed 30 prefix theo quy hoạch số MIC 2024).
  - Lookup thứ tự: `carrier_prefix` tra nhà mạng từ dest → nếu tìm thấy dùng carrier match; nếu không dùng prefix match.
- **Hệ quả**:
  - (+) Ops chỉ cần nhập 6 dòng giá (1 per carrier) cho nội địa, không còn nhập 30+ prefix thủ công.
  - (+) Khi MIC cấp thêm đầu số mới cho một nhà mạng: chỉ cần thêm row `carrier_prefix` bằng Flyway V mới, không cần sửa bảng giá.
  - (+) Đơn giản hóa UI — dropdown chọn nhà mạng thay vì input prefix thủ công.
  - (−) Lookup thêm 1 JOIN hoặc subquery `carrier_prefix` khi route. Có thể cache `carrier_prefix` in-memory (stable data).
  - (−) Phải maintain `carrier_prefix` khi MIC tái phân bổ đầu số (hiếm, ~1-2 lần/năm).
  - (−) Số port (chuyển mạng giữ số) sẽ map sai nhà mạng — chấp nhận phase này, fix bằng HLR lookup phase sau.
- **Alternatives đã cân nhắc**:
  - Option A prefix-only: ops burden cao, dễ lỗi, không thay đổi.
  - Option B carrier-only: đơn giản nhất nhưng mất hỗ trợ giá quốc tế — loại vì một số partner nhắn tin quốc tế.
  - HLR lookup realtime (tra số → carrier tức thì): chính xác nhất nhưng cần integrate API HLR/MNP, tốn tiền per query, ngoài scope Phase 2.
