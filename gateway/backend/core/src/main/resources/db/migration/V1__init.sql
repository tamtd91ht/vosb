-- V1__init.sql
-- Initial schema: 8 tables for SMPP/SMS gateway platform.
-- Webhook config stored as JSONB (ADR-012: partner_api_key secret uses AES-GCM, not bcrypt).

-- partner: top-level entity for SMS gateway customers
CREATE TABLE partner (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(64)     NOT NULL UNIQUE,
    name            VARCHAR(255)    NOT NULL,
    status          VARCHAR(16)     NOT NULL DEFAULT 'ACTIVE',
    -- JSONB: {url, method, headers} — nullable means no webhook configured
    dlr_webhook     JSONB,
    balance         NUMERIC(18, 4)  NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CHECK (status IN ('ACTIVE', 'SUSPENDED'))
);
CREATE INDEX idx_partner_status ON partner(status);

-- partner_smpp_account: SMPP credentials per partner (1 partner → many accounts)
CREATE TABLE partner_smpp_account (
    id              BIGSERIAL PRIMARY KEY,
    partner_id      BIGINT          NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
    system_id       VARCHAR(16)     NOT NULL UNIQUE,     -- SMPP 3.4 max 16 chars
    password_hash   VARCHAR(72)     NOT NULL,            -- bcrypt(plaintext_password, cost=10)
    max_binds       INT             NOT NULL DEFAULT 5,
    ip_whitelist    JSONB           NOT NULL DEFAULT '[]'::jsonb,  -- array of CIDR strings; [] = allow all
    status          VARCHAR(16)     NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CHECK (status IN ('ACTIVE', 'DISABLED'))
);
CREATE INDEX idx_smpp_account_partner ON partner_smpp_account(partner_id);

-- partner_api_key: HTTP API key credentials per partner
-- secret_encrypted + nonce: AES-GCM-256 (see ADR-012) — not bcrypt, because partner may need recovery
CREATE TABLE partner_api_key (
    id                  BIGSERIAL PRIMARY KEY,
    partner_id          BIGINT          NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
    key_id              VARCHAR(32)     NOT NULL UNIQUE, -- public identifier e.g. "ak_live_xxxx"
    secret_encrypted    BYTEA           NOT NULL,        -- AES-GCM-256 ciphertext
    nonce               BYTEA           NOT NULL,        -- 12-byte GCM nonce
    status              VARCHAR(16)     NOT NULL DEFAULT 'ACTIVE',
    label               VARCHAR(64),
    last_used_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CHECK (status IN ('ACTIVE', 'REVOKED'))
);
CREATE INDEX idx_api_key_partner ON partner_api_key(partner_id);

-- channel: outbound dispatch target (HTTP 3rd-party / FreeSWITCH ESL / Telco SMPP)
CREATE TABLE channel (
    id          BIGSERIAL PRIMARY KEY,
    code        VARCHAR(64)     NOT NULL UNIQUE,
    name        VARCHAR(255)    NOT NULL,
    type        VARCHAR(32)     NOT NULL,
    config      JSONB           NOT NULL,    -- schema varies by type; validated at application layer
    status      VARCHAR(16)     NOT NULL DEFAULT 'ACTIVE',
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CHECK (type IN ('HTTP_THIRD_PARTY', 'FREESWITCH_ESL', 'TELCO_SMPP')),
    CHECK (status IN ('ACTIVE', 'DISABLED'))
);
CREATE INDEX idx_channel_type_status ON channel(type, status);

-- route: maps (partner + msisdn_prefix) → channel with priority and optional fallback
CREATE TABLE route (
    id                  BIGSERIAL PRIMARY KEY,
    partner_id          BIGINT          NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
    msisdn_prefix       VARCHAR(16)     NOT NULL,        -- normalized, no '+', e.g. "8490"
    channel_id          BIGINT          NOT NULL REFERENCES channel(id),
    fallback_channel_id BIGINT          REFERENCES channel(id),
    priority            INT             NOT NULL DEFAULT 100,
    enabled             BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (partner_id, msisdn_prefix, priority)
);
CREATE INDEX idx_route_partner_enabled ON route(partner_id, enabled);
CREATE INDEX idx_route_lookup ON route(partner_id, msisdn_prefix);

-- message: inbound SMS/OTP message lifecycle record
CREATE TABLE message (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id          BIGINT      NOT NULL REFERENCES partner(id),
    channel_id          BIGINT      REFERENCES channel(id),     -- null when state=RECEIVED (not yet routed)
    source_addr         VARCHAR(20) NOT NULL,
    dest_addr           VARCHAR(20) NOT NULL,
    content             TEXT        NOT NULL,
    encoding            VARCHAR(16) NOT NULL DEFAULT 'GSM7',    -- GSM7/UCS2/LATIN1
    inbound_via         VARCHAR(8)  NOT NULL,                   -- SMPP/HTTP
    state               VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',
    message_id_telco    VARCHAR(64),                            -- telco/3rd-party ID for DLR correlation
    error_code          VARCHAR(64),
    version             INT         NOT NULL DEFAULT 0,         -- optimistic locking (@Version JPA)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (state IN ('RECEIVED', 'ROUTED', 'SUBMITTED', 'DELIVERED', 'FAILED')),
    CHECK (inbound_via IN ('SMPP', 'HTTP')),
    CHECK (encoding IN ('GSM7', 'UCS2', 'LATIN1'))
);
CREATE INDEX idx_message_partner_created ON message(partner_id, created_at DESC);
CREATE INDEX idx_message_dest ON message(dest_addr);
CREATE INDEX idx_message_telco_id ON message(message_id_telco) WHERE message_id_telco IS NOT NULL;
CREATE INDEX idx_message_state ON message(state) WHERE state IN ('RECEIVED', 'ROUTED', 'SUBMITTED');

-- dlr: delivery receipt records (1 message may have multiple DLRs — interim + final)
CREATE TABLE dlr (
    id          BIGSERIAL   PRIMARY KEY,
    message_id  UUID        NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    state       VARCHAR(16) NOT NULL,                   -- DELIVERED/FAILED/EXPIRED/UNKNOWN
    error_code  VARCHAR(64),
    raw_payload JSONB,                                  -- raw PDU/webhook/ESL snapshot for audit
    source      VARCHAR(16) NOT NULL,                   -- TELCO_SMPP/HTTP_WEBHOOK/FREESWITCH_ESL
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (state IN ('DELIVERED', 'FAILED', 'EXPIRED', 'UNKNOWN')),
    CHECK (source IN ('TELCO_SMPP', 'HTTP_WEBHOOK', 'FREESWITCH_ESL'))
);
CREATE INDEX idx_dlr_message ON dlr(message_id);
CREATE INDEX idx_dlr_received ON dlr(received_at DESC);

-- admin_user: unified login for internal admins and partner portal viewers
CREATE TABLE admin_user (
    id              BIGSERIAL PRIMARY KEY,
    username        VARCHAR(64)     NOT NULL UNIQUE,
    password_hash   VARCHAR(72)     NOT NULL,            -- bcrypt(plaintext_password, cost=10)
    role            VARCHAR(16)     NOT NULL,             -- ADMIN or PARTNER
    partner_id      BIGINT          REFERENCES partner(id),  -- null if ADMIN, required if PARTNER
    enabled         BOOLEAN         NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CHECK (role IN ('ADMIN', 'PARTNER')),
    -- ADMIN must not have partner_id; PARTNER must have partner_id
    CHECK (
        (role = 'ADMIN'   AND partner_id IS NULL) OR
        (role = 'PARTNER' AND partner_id IS NOT NULL)
    )
);
CREATE INDEX idx_admin_user_partner ON admin_user(partner_id);
