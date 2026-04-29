-- V2__provider_pricing.sql
-- Purpose: Introduce delivery_type to channel, and two pricing tables (channel_rate,
--          partner_rate) to support per-prefix cost tracking for SMS and VOICE_OTP.
-- Linked: smpp-plan.md pricing milestone; see data-model.md §2.4 and §2.9/2.10.

-- =============================================================================
-- SECTION 1: Add delivery_type to channel
-- =============================================================================

ALTER TABLE channel
    ADD COLUMN delivery_type VARCHAR(20) NOT NULL DEFAULT 'SMS'
        CHECK (delivery_type IN ('SMS', 'VOICE_OTP'));

-- Back-fill: FREESWITCH_ESL channels carry voice OTP; all others are SMS.
UPDATE channel
   SET delivery_type = 'VOICE_OTP'
 WHERE type = 'FREESWITCH_ESL';

-- =============================================================================
-- SECTION 2: channel_rate — cost the gateway pays to send via a channel
-- =============================================================================

CREATE TABLE channel_rate (
    id              BIGSERIAL    PRIMARY KEY,
    channel_id      BIGINT       NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
    prefix          VARCHAR(16)  NOT NULL DEFAULT '',       -- '' = catch-all; e.g. '849' = Viettel
    rate            NUMERIC(12,4) NOT NULL CHECK (rate >= 0),
    currency        VARCHAR(3)   NOT NULL DEFAULT 'VND',
    unit            VARCHAR(10)  NOT NULL DEFAULT 'MESSAGE'
                        CHECK (unit IN ('MESSAGE', 'SECOND', 'CALL')),
    effective_from  DATE         NOT NULL DEFAULT CURRENT_DATE,
    effective_to    DATE,                                   -- NULL = open-ended / still active
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channel_rate_channel ON channel_rate(channel_id);
CREATE INDEX idx_channel_rate_prefix  ON channel_rate(channel_id, prefix);

-- =============================================================================
-- SECTION 3: partner_rate — price the gateway charges a partner
-- =============================================================================

CREATE TABLE partner_rate (
    id              BIGSERIAL    PRIMARY KEY,
    partner_id      BIGINT       NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
    delivery_type   VARCHAR(20)  NOT NULL DEFAULT 'SMS'
                        CHECK (delivery_type IN ('SMS', 'VOICE_OTP')),
    prefix          VARCHAR(16)  NOT NULL DEFAULT '',       -- '' = catch-all
    rate            NUMERIC(12,4) NOT NULL CHECK (rate >= 0),
    currency        VARCHAR(3)   NOT NULL DEFAULT 'VND',
    unit            VARCHAR(10)  NOT NULL DEFAULT 'MESSAGE'
                        CHECK (unit IN ('MESSAGE', 'SECOND', 'CALL')),
    effective_from  DATE         NOT NULL DEFAULT CURRENT_DATE,
    effective_to    DATE,                                   -- NULL = open-ended / still active
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_partner_rate_partner ON partner_rate(partner_id);
CREATE INDEX idx_partner_rate_prefix  ON partner_rate(partner_id, delivery_type, prefix);
