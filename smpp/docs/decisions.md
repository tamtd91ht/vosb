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
- **Quyết định**: Tách 2 Spring Boot app riêng (`smpp-server`, `worker`) trong cùng Gradle multi-module repo, share `core` module (domain + repo + DTO).
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
  - Nếu partner cấu hình `dlr_webhook_url` → POST JSON tới URL đó (retry 30s/2m/10m, max 3).
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

## ADR mới sẽ append từ ADR-009 trở đi.
