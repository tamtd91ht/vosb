# Provider Dashboard + Pricing System — Execution Plan

> Mục tiêu: (1) Dashboard nhà cung cấp (Provider) phân loại theo SMS / Voice OTP, có stats + status monitoring.
> (2) Hệ thống bảng giá: termination cost per channel + billing rate per partner.
> File này là checklist sống — tick `[x]` khi task xong.

---

## 🔁 Resume here for next session

**Trạng thái cuối** (cập nhật `2026-04-28`): **C01 ✅ C02 ✅ C03 ✅ C04 ✅ C05 ✅ C06 ✅ R01 ✅ R02 ✅ R03 ✅ R04 ✅ R05 ✅** — BE + FE hoàn tất. `pnpm build` 22 routes xanh. Provider Adapter pattern cho HTTP channels (eSMS, Abenla, Vietguys, SpeedSMS, Infobip, Stringee, Custom). Channel rate + Partner rate CRUD. `/admin/channels` redirect → `/admin/providers`. R06 (Rate Lookup utility) chưa làm — optional.

### Thứ tự thực hiện

```
C01+R01 (migration gộp)
  → C02 (BE entity/handler update)
  → C03 (BE stats API)
  → C04 (FE Provider List page)
  → C05 (FE Provider Detail + Rate tab)
  → C06 (FE sidebar + nav update)
  → R02 (BE channel rate API)
  → R03 (BE partner rate API)
  → R04 (FE channel rate UI — trong C05)
  → R05 (FE partner rate UI — trong partner detail)
  → R06 (BE rate lookup utility)
```

---

## Phân tích hiện trạng

### Vấn đề với Channel hiện tại

| Vấn đề | Hệ quả |
|---|---|
| `HTTP_THIRD_PARTY` không phân biệt SMS vs Voice OTP | Worker không biết channel này dùng cho loại tin nào |
| Admin UI `/admin/channels` chỉ có create/list/delete | Không xem được stats, không test kết nối |
| Không có bảng giá | Không tính được chi phí termination hay billing partner |
| Không có Provider Detail page | Không sửa được config sau khi tạo |

### Channel types hiện tại

```
HTTP_THIRD_PARTY   — REST API bên ngoài (SMS hoặc Voice OTP — ambiguous!)
FREESWITCH_ESL     — FreeSWITCH Event Socket (luôn là Voice OTP)
TELCO_SMPP         — SMPP client tới telco (luôn là SMS)
```

### Message table đã có `channel_id` (nullable FK) — có thể dùng cho stats ngay.

---

## Kiến trúc quyết định

### Decision 1: Phân loại SMS vs Voice OTP cho HTTP channel

**3 options:**
- **Option A**: Thêm cột `delivery_type VARCHAR(20) DEFAULT 'SMS'` vào channel table
- **Option B**: Tách enum thành `HTTP_SMS_API` + `HTTP_VOICE_API` (thay vì `HTTP_THIRD_PARTY`)
- **Option C**: Infer từ config (fragile — không dùng)

**Chọn: Option A — thêm `delivery_type`**

Lý do:
- Non-breaking: existing `HTTP_THIRD_PARTY` channels mặc định thành `SMS`
- `FREESWITCH_ESL` → `VOICE_OTP` (auto-set by migration); `TELCO_SMPP` → `SMS` (auto-set)
- Worker phase sau dùng `delivery_type` để filter channel phù hợp với loại tin nhắn

Giá trị cho phép: `SMS` | `VOICE_OTP`

### Decision 2: Cấu trúc bảng giá

**2 loại rate:**

1. **`channel_rate`** — Termination cost: TKC trả bao nhiêu cho mỗi channel/provider
   - Theo prefix đích (VD: `84` VND 200/msg, `1` VND 1500/msg)
   - Với Voice OTP: theo giây (unit=SECOND) hoặc theo cuộc (unit=CALL)

2. **`partner_rate`** — Billing rate: TKC thu của partner bao nhiêu
   - Theo `delivery_type` (SMS vs Voice OTP) + prefix đích
   - Margin = `partner_rate - channel_rate`

**Rate lookup priority**: `longest prefix match` → `effective date range` → `catch-all (prefix='')`

---

## DB Schema Changes

### V2__provider_pricing.sql (migration mới)

```sql
-- 1. Add delivery_type to channel
ALTER TABLE channel ADD COLUMN delivery_type VARCHAR(20) NOT NULL DEFAULT 'SMS';
UPDATE channel SET delivery_type = 'VOICE_OTP' WHERE type = 'FREESWITCH_ESL';
-- TELCO_SMPP stays SMS; HTTP_THIRD_PARTY stays SMS by default

-- 2. Channel rate table (termination cost)
CREATE TABLE channel_rate (
  id            BIGSERIAL PRIMARY KEY,
  channel_id    BIGINT NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  prefix        VARCHAR(16) NOT NULL DEFAULT '',  -- '' = catch-all
  rate          NUMERIC(12, 4) NOT NULL CHECK (rate >= 0),
  currency      VARCHAR(3) NOT NULL DEFAULT 'VND',
  unit          VARCHAR(10) NOT NULL DEFAULT 'MESSAGE' CHECK (unit IN ('MESSAGE','SECOND','CALL')),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,  -- NULL = open-ended
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_channel_rate_channel ON channel_rate(channel_id);
CREATE INDEX idx_channel_rate_prefix  ON channel_rate(channel_id, prefix);

-- 3. Partner rate table (billing rate)
CREATE TABLE partner_rate (
  id            BIGSERIAL PRIMARY KEY,
  partner_id    BIGINT NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  delivery_type VARCHAR(20) NOT NULL DEFAULT 'SMS' CHECK (delivery_type IN ('SMS','VOICE_OTP')),
  prefix        VARCHAR(16) NOT NULL DEFAULT '',
  rate          NUMERIC(12, 4) NOT NULL CHECK (rate >= 0),
  currency      VARCHAR(3) NOT NULL DEFAULT 'VND',
  unit          VARCHAR(10) NOT NULL DEFAULT 'MESSAGE' CHECK (unit IN ('MESSAGE','SECOND','CALL')),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_partner_rate_partner ON partner_rate(partner_id);
CREATE INDEX idx_partner_rate_prefix  ON partner_rate(partner_id, delivery_type, prefix);
```

---

## Feature 1 — Provider Dashboard

### Task C01 — Flyway migration + JPA entity update

**Files:**
```
core/src/main/resources/db/migration/V2__provider_pricing.sql
core/.../domain/Channel.java               — add deliveryType field
core/.../domain/enums/DeliveryType.java    — enum SMS | VOICE_OTP
```

**Channel.java thêm:**
```java
@Column(name = "delivery_type", nullable = false)
@Enumerated(EnumType.STRING)
private DeliveryType deliveryType = DeliveryType.SMS;
```

**DoD:**
- `\d channel` ra cột `delivery_type`
- FREESWITCH_ESL rows có `delivery_type = 'VOICE_OTP'`
- App start + Hibernate validate xanh

---

### Task C02 — Backend: Update ChannelHandlers

**Thay đổi:**
- `CreateChannelRequest` thêm field `deliveryType` (optional, default SMS; auto-set VOICE_OTP cho FREESWITCH_ESL)
- `ChannelResponse` thêm `delivery_type`
- Validate: nếu type=`FREESWITCH_ESL` → force `delivery_type=VOICE_OTP`; type=`TELCO_SMPP` → force `delivery_type=SMS`; type=`HTTP_THIRD_PARTY` → user chọn

**API thay đổi:**
```
POST /api/admin/channels   — body thêm delivery_type (optional)
GET  /api/admin/channels   — response thêm delivery_type
GET  /api/admin/channels/{id} — response thêm delivery_type (cần thêm endpoint này nếu chưa có)
PUT  /api/admin/channels/{id} — update config + status + delivery_type
```

**DoD:** POST channel với `delivery_type=VOICE_OTP` → GET trả về đúng; FREESWITCH_ESL luôn VOICE_OTP dù client gửi SMS.

---

### Task C03 — Backend: Channel Stats API

**Endpoint mới:**
```
GET /api/admin/channels/{id}/stats?period=7d|30d|today
Response:
{
  "period": "7d",
  "total": 15420,
  "delivered": 14800,
  "failed": 620,
  "delivery_rate": 0.9598,
  "by_state": { "SUBMITTED": 0, "DELIVERED": 14800, "FAILED": 620 },
  "by_day": [ { "date": "2026-04-22", "total": 2100, "delivered": 2050 }, ... ]
}
```

**Query:**
```sql
-- Total by state
SELECT state, COUNT(*) FROM message
WHERE channel_id = ? AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY state;

-- By day
SELECT DATE_TRUNC('day', created_at) AS day, state, COUNT(*)
FROM message WHERE channel_id = ? AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1, 2 ORDER BY 1;
```

**Files:** `http/admin/channel/ChannelHandlers.java` thêm `stats()` method.

**DoD:** GET `/api/admin/channels/1/stats?period=7d` → JSON với breakdown đúng.

---

### Task C04 — Frontend: `/admin/providers` — Provider Dashboard

**Thay thế `/admin/channels` bằng `/admin/providers`** (redirect cũ → mới).

**Layout:**

```
┌─────────────────────────────────────────────────────┐
│  [+ Thêm nhà cung cấp]                              │
├─────────────────────────────────────────────────────┤
│ 📨 SMS Providers (3)                                │
│  ┌──────────────────┐  ┌──────────────────┐        │
│  │ [SMPP] Viettel   │  │ [HTTP] BrandSMS  │        │
│  │ ● ACTIVE         │  │ ● ACTIVE         │        │
│  │ Hôm nay: 12,450  │  │ Hôm nay: 3,200   │        │
│  │ Success: 98.2%   │  │ Success: 97.1%   │        │
│  │ [Test] [Chi tiết]│  │ [Test] [Chi tiết]│        │
│  └──────────────────┘  └──────────────────┘        │
├─────────────────────────────────────────────────────┤
│ 🔊 Voice OTP Providers (2)                          │
│  ┌──────────────────┐  ┌──────────────────┐        │
│  │ [ESL] FreeSW-01  │  │ [HTTP] VoiceAPI  │        │
│  │ ● ACTIVE         │  │ ⊗ DISABLED       │        │
│  │ Hôm nay: 850     │  │ Hôm nay: 0       │        │
│  │ [Test] [Chi tiết]│  │ [Test] [Chi tiết]│        │
│  └──────────────────┘  └──────────────────┘        │
└─────────────────────────────────────────────────────┘
```

**Files:**
```
src/app/(admin)/admin/providers/page.tsx
src/app/(admin)/admin/providers/ProvidersClient.tsx
src/app/(admin)/admin/channels/page.tsx  — redirect → /admin/providers
```

**API calls:**
- `GET /api/admin/channels?size=100` — list all channels (dùng lại existing API)
- `GET /api/admin/channels/{id}/stats?period=today` — per-card stats (parallel queries)
- `POST /api/admin/channels/{id}/test-ping` — inline result

**Features per card:**
- Type badge (TELCO SMPP / HTTP SMS API / FreeSWITCH ESL / HTTP Voice API)
- Status badge + toggle (ACTIVE/DISABLED)
- Today's traffic: total + delivery rate
- Test Ping button → loading → result inline (reachable ✓ / unreachable ✗ + latency)
- Chi tiết button → `/admin/providers/[id]`

**DoD:** Cards render đúng 2 sections; test-ping hiện kết quả inline; create flow vẫn hoạt động.

---

### Task C05 — Frontend: `/admin/providers/[id]` — Provider Detail

**3 tabs:**

**Tab 1 — Cấu hình:**
- Hiện config hiện tại (masked sensitive fields: password, signing_secret)
- "Sửa cấu hình" button → inline edit form (type-specific)
- Status toggle + "Lưu thay đổi"

**Tab 2 — Thống kê:**
- Period selector: Hôm nay | 7 ngày | 30 ngày
- 4 KPI cards: Tổng tin, Thành công, Thất bại, Tỉ lệ
- Bar chart (hoặc AreaChart từ recharts): by_day data
- Table: breakdown by state

**Tab 3 — Bảng giá (channel_rate):**
- Rate table: prefix | rate | currency | unit | from | to | actions
- "Thêm giá" → dialog form
- Edit/Delete inline
- Ghi chú: prefix '' = áp dụng cho mọi đầu số

**Files:**
```
src/app/(admin)/admin/providers/[id]/page.tsx
src/app/(admin)/admin/providers/[id]/ProviderDetailClient.tsx
src/app/(admin)/admin/providers/[id]/tabs/ConfigTab.tsx
src/app/(admin)/admin/providers/[id]/tabs/StatsTab.tsx
src/app/(admin)/admin/providers/[id]/tabs/RatesTab.tsx
```

**DoD:** 3 tabs render; edit config save; stats chart hiện 7 ngày; rate CRUD hoạt động.

---

### Task C06 — Frontend: Admin sidebar update

**Thay đổi AdminSidebar.tsx:**

```
Dashboard
Đối tác
─── Channels → Providers (label + href update)
    href: /admin/providers
    description: "Nhà cung cấp"
Route
Pricing (NAV MỚI)
  Bảng giá kênh → /admin/providers/{id} (deep link)
  Bảng giá đối tác → /admin/pricing/partners
Tin nhắn
Sessions
Người dùng
```

Hoặc đơn giản hơn: chỉ update label "Kênh" → "Nhà cung cấp" + href `/admin/providers`, và thêm nav item "Bảng giá" → `/admin/pricing`.

**Files:** `src/components/layout/AdminSidebar.tsx`

---

## Feature 2 — Pricing System

### Task R01 — Flyway migration: rate tables (gộp vào C01 → V2__provider_pricing.sql)

**JPA entities mới:**
```
core/.../domain/ChannelRate.java
core/.../domain/PartnerRate.java
core/.../domain/enums/RateUnit.java  — MESSAGE | SECOND | CALL
core/.../repository/ChannelRateRepository.java
core/.../repository/PartnerRateRepository.java
```

**ChannelRateRepository thêm:**
```java
List<ChannelRate> findByChannelIdAndEffectiveFromLessThanEqualAndEffectiveToIsNull(Long channelId, LocalDate today);
// Hoặc @Query với JPQL để filter active rates
```

**DoD:** `\dt` ra `channel_rate` + `partner_rate`; App start + validate xanh.

---

### Task R02 — Backend: Channel Rate CRUD API

**Endpoints:**
```
GET    /api/admin/channels/{id}/rates          — list rates (sorted: prefix DESC, effective_from DESC)
POST   /api/admin/channels/{id}/rates          — add rate
PUT    /api/admin/channels/{id}/rates/{rateId} — update rate
DELETE /api/admin/channels/{id}/rates/{rateId} — delete rate
```

**Request body (POST/PUT):**
```json
{
  "prefix": "849",
  "rate": 250.0,
  "currency": "VND",
  "unit": "MESSAGE",
  "effective_from": "2026-05-01",
  "effective_to": null
}
```

**Validation:**
- `rate >= 0`
- `prefix` chỉ chứa số (hoặc empty string)
- `effective_to >= effective_from` nếu có
- Cảnh báo (không block) nếu prefix overlap với rate hiện có

**Files:** `http/admin/channel/ChannelRateHandlers.java`
Mount: `/api/admin/channels/{id}/rates` trong `AdminRouterFactory`

**DoD:** CRUD round-trip; rate lọc đúng theo channelId; 404 khi channel không tồn tại.

---

### Task R03 — Backend: Partner Rate CRUD API

**Endpoints:**
```
GET    /api/admin/partners/{id}/rates          — list (filter by delivery_type optional)
POST   /api/admin/partners/{id}/rates          — add
PUT    /api/admin/partners/{id}/rates/{rateId} — update
DELETE /api/admin/partners/{id}/rates/{rateId} — delete
```

**Request body:**
```json
{
  "delivery_type": "SMS",
  "prefix": "",
  "rate": 350.0,
  "currency": "VND",
  "unit": "MESSAGE",
  "effective_from": "2026-05-01"
}
```

**Files:** `http/admin/partner/PartnerRateHandlers.java`

**DoD:** CRUD round-trip; rates phân tách đúng theo delivery_type.

---

### Task R04 — Frontend: Channel Rate UI (trong tab "Bảng giá" của C05)

**RatesTab.tsx** (trong Provider Detail):

```
┌─────────────────────────────────────────────────────┐
│ Bảng giá kênh (termination cost)    [+ Thêm giá]    │
├──────────┬──────────┬─────┬────────┬────────┬───────┤
│ Prefix   │ Giá/tin  │ ĐVT │ Từ     │ Đến    │       │
├──────────┼──────────┼─────┼────────┼────────┼───────┤
│ 849      │ 250 VND  │ MSG │ 01/05  │ —      │ ✎ 🗑  │
│ (all)    │ 200 VND  │ MSG │ 01/01  │ —      │ ✎ 🗑  │
└──────────┴──────────┴─────┴────────┴────────┴───────┘
```

**Add/Edit dialog:**
- Prefix input (placeholder: "849" hoặc để trống = catch-all)
- Rate input (số) + currency select (VND/USD)
- Unit select (MESSAGE / SECOND / CALL)
- Date pickers: effective_from (required) + effective_to (optional)

**DoD:** CRUD UI hoạt động; dialog hiện đúng effective dates.

---

### Task R05 — Frontend: Partner Rate UI

**Đặt trong: `/admin/partners/[id]`** (cần tạo Partner Detail page nếu chưa có).

Hiện tại `/admin/partners` chỉ có list. Cần thêm Partner Detail page với:
- Header: partner info (code, name, status, balance)
- Tabs: Thông tin | SMPP Accounts | API Keys | Bảng giá

**Tab Bảng giá:**
```
Delivery type filter: [SMS ▼]  [VOICE_OTP ▼]

┌────────┬──────────┬─────┬─────────┬────────┬───────┐
│ Loại   │ Prefix   │ Giá │ ĐVT     │ Từ     │       │
├────────┼──────────┼─────┼─────────┼────────┼───────┤
│ SMS    │ (all)    │ 350 │ MESSAGE │ 01/05  │ ✎ 🗑  │
│ VOICE  │ (all)    │ 800 │ CALL    │ 01/05  │ ✎ 🗑  │
└────────┴──────────┴─────┴─────────┴────────┴───────┘
```

**Files:**
```
src/app/(admin)/admin/partners/[id]/page.tsx
src/app/(admin)/admin/partners/[id]/PartnerDetailClient.tsx
src/app/(admin)/admin/partners/[id]/tabs/InfoTab.tsx
src/app/(admin)/admin/partners/[id]/tabs/SmppTab.tsx
src/app/(admin)/admin/partners/[id]/tabs/ApiKeysTab.tsx
src/app/(admin)/admin/partners/[id]/tabs/RatesTab.tsx
```

**DoD:** Partner Detail hiện đúng 4 tabs; Rate CRUD hoạt động; list partner cũ vẫn hoạt động.

---

### Task R06 — Backend: Rate Lookup Utility API

**Mục đích:** Debugging tool — admin nhập partner + dest_addr → xem route nào được chọn + giá áp dụng.

```
GET /api/admin/rates/lookup?partner_id=1&dest_addr=84901234567&delivery_type=SMS

Response:
{
  "partner_id": 1,
  "dest_addr": "84901234567",
  "delivery_type": "SMS",
  "matched_route": { "id": 5, "prefix": "849", "priority": 100 },
  "channel": { "id": 3, "name": "Viettel SMPP", "type": "TELCO_SMPP" },
  "channel_rate": { "prefix": "849", "rate": 250.0, "currency": "VND" },
  "partner_rate": { "delivery_type": "SMS", "prefix": "", "rate": 350.0, "currency": "VND" },
  "margin": 100.0
}
```

**Notes:**
- Dùng RouteResolver logic (đọc route table, sort by priority+prefix) — KHÔNG cache version, trực tiếp DB
- Nếu không tìm thấy route → `matched_route: null, channel: null`
- Nếu không có rate entry → `channel_rate: null, partner_rate: null`

**Files:** `http/admin/stats/RateLookupHandler.java`

**DoD:** Lookup với partner + dest_addr biết route → kết quả đúng; partner không có route → null gracefully.

---

## Checklist tổng

| Task | Mô tả | Depends | Size | Status |
|---|---|---|---|---|
| **C01** | Migration V2: add delivery_type to channel | — | XS | [x] |
| **C02** | BE: update Channel entity + ChannelHandlers (delivery_type) | C01 | S | [x] |
| **C03** | BE: GET /channels/{id}/stats endpoint | C01 | S | [x] |
| **C04** | FE: /admin/providers list (card grid, 2 sections SMS/Voice) | C02, C03 | M | [x] |
| **C05** | FE: /admin/providers/[id] detail (3 tabs: config/stats/rates) | C04, R02 | L | [x] |
| **C06** | FE: sidebar update (Kênh → Providers, add Pricing nav) | C04 | XS | [x] |
| **R01** | Migration V2 (cùng file C01): channel_rate + partner_rate tables | C01 | S | [x] |
| **R02** | BE: Channel Rate CRUD (/channels/{id}/rates) | R01 | S | [x] |
| **R03** | BE: Partner Rate CRUD (/partners/{id}/rates) | R01 | S | [x] |
| **R04** | FE: Channel Rate UI (tab trong C05) | R02, C05 | S | [x] |
| **R05** | FE: Partner Detail page + Rate tab | R03 | M | [x] |
| **R06** | BE: Rate Lookup API (/admin/rates/lookup) | R02, R03 | S | [ ] |

Size: XS=<30min, S=<2h, M=2-4h, L=4-6h

---

## API endpoints mới (toàn bộ)

### Channel (BE updates)
```
GET  /api/admin/channels/{id}              — NEW (single channel + delivery_type)
PUT  /api/admin/channels/{id}              — NEW (update config + delivery_type + status)
GET  /api/admin/channels/{id}/stats        — NEW (?period=today|7d|30d)
POST /api/admin/channels/{id}/test-ping    — EXISTING (đã có T14 — verify hoặc implement)
```

### Channel Rate (BE new)
```
GET    /api/admin/channels/{id}/rates
POST   /api/admin/channels/{id}/rates
PUT    /api/admin/channels/{id}/rates/{rateId}
DELETE /api/admin/channels/{id}/rates/{rateId}
```

### Partner Rate (BE new)
```
GET    /api/admin/partners/{id}/rates           ?delivery_type=SMS|VOICE_OTP
POST   /api/admin/partners/{id}/rates
PUT    /api/admin/partners/{id}/rates/{rateId}
DELETE /api/admin/partners/{id}/rates/{rateId}
```

### Rate Lookup (BE new)
```
GET    /api/admin/rates/lookup              ?partner_id=&dest_addr=&delivery_type=
```

---

## TypeScript types mới (FE)

```typescript
type DeliveryType = "SMS" | "VOICE_OTP";
type RateUnit = "MESSAGE" | "SECOND" | "CALL";

// Updated Channel type
type Channel = {
  id: number;
  code: string;
  name: string;
  type: ChannelType;
  delivery_type: DeliveryType;  // NEW
  config: Record<string, unknown>;
  status: ChannelStatus;
  created_at: string;
  updated_at: string;
};

type ChannelRate = {
  id: number;
  channel_id: number;
  prefix: string;          // '' = catch-all
  rate: number;
  currency: string;        // 'VND' | 'USD'
  unit: RateUnit;
  effective_from: string;  // ISO date
  effective_to: string | null;
  created_at: string;
};

type PartnerRate = {
  id: number;
  partner_id: number;
  delivery_type: DeliveryType;
  prefix: string;
  rate: number;
  currency: string;
  unit: RateUnit;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

type ChannelStats = {
  period: string;
  total: number;
  delivered: number;
  failed: number;
  delivery_rate: number;
  by_state: Record<string, number>;
  by_day: Array<{ date: string; total: number; delivered: number; failed: number }>;
};

type RateLookupResult = {
  partner_id: number;
  dest_addr: string;
  delivery_type: DeliveryType;
  matched_route: { id: number; prefix: string; priority: number } | null;
  channel: { id: number; name: string; type: ChannelType } | null;
  channel_rate: ChannelRate | null;
  partner_rate: PartnerRate | null;
  margin: number | null;
};
```

---

## FE file tree (mới tạo)

```
src/
├── app/(admin)/admin/
│   ├── providers/
│   │   ├── page.tsx
│   │   ├── ProvidersClient.tsx
│   │   └── [id]/
│   │       ├── page.tsx
│   │       ├── ProviderDetailClient.tsx
│   │       └── tabs/
│   │           ├── ConfigTab.tsx
│   │           ├── StatsTab.tsx
│   │           └── RatesTab.tsx        ← channel_rate CRUD
│   ├── partners/
│   │   ├── page.tsx (unchanged — list)
│   │   ├── PartnersClient.tsx (unchanged)
│   │   └── [id]/
│   │       ├── page.tsx
│   │       ├── PartnerDetailClient.tsx
│   │       └── tabs/
│   │           ├── InfoTab.tsx
│   │           ├── SmppTab.tsx
│   │           ├── ApiKeysTab.tsx
│   │           └── RatesTab.tsx        ← partner_rate CRUD
│   └── channels/
│       └── page.tsx  ← redirect → /admin/providers
└── components/layout/
    └── AdminSidebar.tsx  ← updated
```

---

## Ghi chú scope

- Pricing system Phase này: **admin UI only** — nhập và quản lý rate table. Worker CHƯA dùng rate table để tính cost thực tế (đó là Phase 5+).
- Rate Lookup API (R06) là utility debugging tool — không phải billing engine.
- Channel stats chỉ đếm messages từ table có `channel_id` — messages chưa route (RECEIVED state) không tính vào.
- `test-ping` cho TELCO_SMPP và FREESWITCH_ESL: Phase này trả `{ "supported": false }` nếu chưa implement dispatcher; chỉ HTTP là real ping.
