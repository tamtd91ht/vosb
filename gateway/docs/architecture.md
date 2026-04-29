# Architecture — SMPP/Voice Gateway

## 1. Bài toán nghiệp vụ

Hệ thống đóng vai trò **aggregator gateway 2 chiều**:

- **Inbound**: nhận yêu cầu gửi SMS/voice OTP từ đối tác (partner) qua **SMPP server** (port 2775) hoặc **HTTP API**.
- **Routing**: worker đọc cấu hình routing để chọn channel đẩy message đi: **3rd-party API** (REST), **FreeSWITCH** (voice OTP qua ESL), hoặc **SMPP client** bind ra **SMSC nhà mạng**.
- **DLR**: nhận trạng thái giao kết từ telco/3rd-party/FreeSWITCH, lưu DB, forward ngược về partner.

Mỗi partner có thể có nhiều route (theo prefix MSISDN đích) trỏ tới channel khác nhau, có priority + fallback.

---

## 2. Sơ đồ tổng thể

```
                                Internet
                                   │
                           ┌───────┴───────┐
                           │ Nginx (host)  │   TLS, vhost, rate-limit
                           │  :80 :443     │
                           └───────┬───────┘
                                   │ HTTPS
              ┌────────────────────┼─────────────────────┐
              │                                          │
        ┌─────▼──────┐                            ┌──────▼──────┐
        │  frontend  │       app-net              │ smpp-server │
        │  Next.js   │◄──────────────────────────►│ Spring Boot │
        │  :3000     │                            │  :8080 HTTP │
        └────────────┘                            │  :2775 SMPP │  ← public
                                                  └──────┬──────┘
                                                         │ infra-net
                                       ┌─────────────────┼──────────────────┐
                                       │                 │                  │
                                  ┌────▼────┐     ┌──────▼─────┐     ┌──────▼─────┐
                                  │postgres │     │   redis    │     │  rabbitmq  │
                                  │  :5432  │     │   :6379    │     │   :5672    │
                                  └─────────┘     └────────────┘     └──────┬─────┘
                                                                            │
                                                                     ┌──────▼──────┐
                                                                     │   worker    │
                                                                     │ Spring Boot │
                                                                     │ (no HTTP)   │
                                                                     └─┬──┬──┬─────┘
                                                                       │  │  │
                                                                ┌──────┘  │  └────────┐
                                                                ▼         ▼           ▼
                                                          3rd-party  FreeSWITCH   Telco SMSC
                                                          REST API   (ESL TCP)    (SMPP client)
```

Diagram outbound chi tiết hơn xem `dispatchers.md`.

---

## 3. Thành phần ↔ Vai trò ↔ Port

| Thành phần | Vai trò | Port | Public |
|---|---|---|---|
| Nginx (host) | TLS termination, reverse proxy | 80, 443 | ✓ |
| `smpp-server` (container) | SMPP listener inbound + HTTP API | 2775, 8080 | 2775 ✓ / 8080 chỉ qua nginx |
| `worker` (container) | Routing + dispatch + DLR ingress | — | — |
| `frontend` (container) | Next.js web UI (admin + portal) | 3000 | chỉ qua nginx |
| `postgres` (container) | Master data + message log | 5432 | ✗ |
| `redis` (container) | Route cache, session state, dedupe | 6379 | ✗ |
| `rabbitmq` (container) | Message bus (inbound/dlr) | 5672, 15672 | 15672 chỉ `127.0.0.1` (SSH tunnel) |

Quy ước: chỉ port 22 (SSH), 80, 443, **2775** được mở trên UFW. Tất cả service backend khác không expose ra internet.

---

## 4. Message flow

### 4.1 Inbound (partner → gateway)

```
Partner ──submit_sm──►  smpp-server  ──save MESSAGE state=RECEIVED──►  postgres
   │       OR                                                           
   └───POST /api/v1/messages (HMAC)──►  smpp-server  ──publish sms.inbound──►  rabbitmq
                                                                              │
                                                       smpp-server trả ack/202 cho partner
```

### 4.2 Routing + dispatch

```
worker ──consume sms.inbound──►  RouteResolver(partner_id, dest_addr)
                                       │
                              query Redis cache route:<partner_id>
                                       │ (miss → load DB)
                                       ▼
                                ChannelDispatcher.dispatch()
                                  │       │       │
                              HTTP    ESL       SMPP client
                              3rd-p.  FreeSwitch  → telco SMSC
                                       │
                              update MESSAGE state=SUBMITTED
                              (hoặc FAILED nếu fallback cũng fail)
```

### 4.3 DLR (telco/3rd-party → partner)

```
Telco SMSC ──deliver_sm (DLR)──►  worker (TelcoSmppDispatcher session)
3rd-party  ──webhook POST────►   smpp-server (/api/internal/dlr/{channel_id})
FreeSWITCH ──CHANNEL_HANGUP──►   worker (FreeSwitchEslDispatcher event)
                                       │
                              save DLR record + update MESSAGE state
                                       │
                              publish sms.dlr (rabbitmq)
                                       │
                              smpp-server consume sms.dlr
                                       │
                                       ▼
                          Partner có session SMPP active?
                                  │           │
                                yes           no
                                  │           │
                          deliver_sm      Webhook URL có cấu hình?
                          tới partner          │       │
                                              yes      no
                                              │        │
                                          POST       lưu DB,
                                          webhook    partner pull qua
                                                     GET /api/v1/messages/{id}
```

5 bước rút gọn (cho doc spec):
1. Partner gửi message vào (SMPP/HTTP).
2. smpp-server lưu DB + publish `sms.inbound`.
3. worker route + dispatch ra channel ngoài.
4. DLR đến qua 1 trong 3 nguồn → save + publish `sms.dlr`.
5. smpp-server forward DLR về partner (deliver_sm hoặc webhook).

---

## 5. Network

Hai bridge network Docker:

- `infra-net` — đã tạo sẵn (xem `infras.md`). Chứa `postgres`, `redis`, `rabbitmq`. Cả `smpp-server` và `worker` join network này.
- `app-net` — tạo bởi `~/apps/smpp-app/docker-compose.yml`. Chứa `smpp-server`, `worker`, `frontend`. Cho phép `frontend` gọi `smpp-server` qua DNS name nội bộ.

Nginx chạy **trên host** (không trong Docker), gọi tới container qua `127.0.0.1:8080` và `127.0.0.1:3000` (các port này được bind chỉ tới loopback).

---

## 6. Quyết định kiến trúc lớn

| # | Quyết định | Lý do tóm tắt | Chi tiết |
|---|---|---|---|
| 1 | Tách 2 service: `smpp-server` + `worker` | Scale độc lập, fault isolation, vai trò rõ | `decisions.md` ADR-001 |
| 2 | Spring Boot 3 + jSMPP | Hệ sinh thái lớn, doc tốt, đề xuất trong infra docs | ADR-002 |
| 3 | 1 Next.js app multi-role | Share component, build/deploy 1 container | ADR-003 |
| 4 | FreeSWITCH ESL TCP | Realtime event, latency thấp | ADR-004 |
| 5 | Routing partner+prefix | Đủ cho 90% case, đơn giản | ADR-005 |
| 6 | SMPP system_id+pwd, API HMAC | Chuẩn ngành, không cần OAuth phức tạp | ADR-006 |
| 7 | DLR forward về partner | Partner cần realtime, chuẩn ngành SMS | ADR-007 |
| 8 | Phase 1: Actuator + log file | Function trước, observability sau | ADR-008 |

---

## 7. Mở rộng tương lai (out of scope phase 1)

- Cluster RabbitMQ + HA Postgres (replica).
- Prometheus + Grafana + Loki cho observability.
- Long-message UDH reassembly (multi-segment SMS).
- Billing engine + invoice.
- Multi-region active-active deployment.
- gRPC nội bộ giữa smpp-server và worker (thay AMQP) cho latency thấp.
