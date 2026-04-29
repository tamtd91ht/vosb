-- V3__carrier_prefix.sql
-- Purpose: Introduce carrier_prefix lookup table for Vietnamese domestic carrier detection,
--          and add carrier column to channel_rate/partner_rate to support hybrid routing logic:
--          domestic rates are matched by carrier name; international/catch-all rates use msisdn prefix.
-- Linked: data-model.md §2.10, §2.4.2, §2.9.

-- =============================================================================
-- SECTION 1: carrier_prefix — E.164 4-digit prefix to carrier mapping (VN domestic)
-- =============================================================================

-- prefix: first 4 digits of E.164 number (country code 84 + 2-digit block),
--         e.g. local 0861234567 → E.164 84861234567 → prefix '8486'.
-- carrier: canonical carrier name (VIETTEL/MOBIFONE/VINAPHONE/VIETNAMOBILE/GMOBILE/REDDI).

CREATE TABLE carrier_prefix (
    prefix  VARCHAR(8)  PRIMARY KEY,
    carrier VARCHAR(20) NOT NULL
);

CREATE INDEX idx_carrier_prefix_carrier ON carrier_prefix(carrier);

-- Seed: Vietnamese domestic carrier prefix table (as of 2024, VNPT/MIC numbering plan).
-- Source: Bộ TT&TT Việt Nam — quy hoạch số E.164 084xx.

-- VIETTEL
INSERT INTO carrier_prefix (prefix, carrier) VALUES
    ('8486', 'VIETTEL'),
    ('8496', 'VIETTEL'),
    ('8497', 'VIETTEL'),
    ('8498', 'VIETTEL'),
    ('8432', 'VIETTEL'),
    ('8433', 'VIETTEL'),
    ('8434', 'VIETTEL'),
    ('8435', 'VIETTEL'),
    ('8436', 'VIETTEL'),
    ('8437', 'VIETTEL'),
    ('8438', 'VIETTEL'),
    ('8439', 'VIETTEL');

-- MOBIFONE
INSERT INTO carrier_prefix (prefix, carrier) VALUES
    ('8470', 'MOBIFONE'),
    ('8476', 'MOBIFONE'),
    ('8477', 'MOBIFONE'),
    ('8478', 'MOBIFONE'),
    ('8479', 'MOBIFONE'),
    ('8489', 'MOBIFONE'),
    ('8490', 'MOBIFONE'),
    ('8493', 'MOBIFONE');

-- VINAPHONE
INSERT INTO carrier_prefix (prefix, carrier) VALUES
    ('8481', 'VINAPHONE'),
    ('8482', 'VINAPHONE'),
    ('8483', 'VINAPHONE'),
    ('8484', 'VINAPHONE'),
    ('8485', 'VINAPHONE'),
    ('8488', 'VINAPHONE'),
    ('8491', 'VINAPHONE'),
    ('8494', 'VINAPHONE');

-- VIETNAMOBILE
INSERT INTO carrier_prefix (prefix, carrier) VALUES
    ('8452', 'VIETNAMOBILE'),
    ('8456', 'VIETNAMOBILE'),
    ('8458', 'VIETNAMOBILE'),
    ('8492', 'VIETNAMOBILE');

-- GMOBILE
INSERT INTO carrier_prefix (prefix, carrier) VALUES
    ('8459', 'GMOBILE'),
    ('8499', 'GMOBILE');

-- REDDI
INSERT INTO carrier_prefix (prefix, carrier) VALUES
    ('8455', 'REDDI');

-- =============================================================================
-- SECTION 2: channel_rate — add carrier column
-- =============================================================================

-- carrier IS NOT NULL → domestic rate; matched by carrier name (prefix field ignored for lookup).
-- carrier IS NULL     → international or catch-all rate; matched by prefix field (longest-prefix match).

ALTER TABLE channel_rate
    ADD COLUMN carrier VARCHAR(20);

COMMENT ON COLUMN channel_rate.carrier IS
    'Domestic carrier name (VIETTEL/MOBIFONE/…). NOT NULL = domestic rate matched by carrier; NULL = international/catch-all, matched by prefix field.';

CREATE INDEX idx_channel_rate_carrier ON channel_rate(channel_id, carrier)
    WHERE carrier IS NOT NULL;

-- =============================================================================
-- SECTION 3: partner_rate — add carrier column
-- =============================================================================

-- Same hybrid logic as channel_rate.carrier above.

ALTER TABLE partner_rate
    ADD COLUMN carrier VARCHAR(20);

COMMENT ON COLUMN partner_rate.carrier IS
    'Domestic carrier name (VIETTEL/MOBIFONE/…). NOT NULL = domestic rate matched by carrier; NULL = international/catch-all, matched by prefix field.';

CREATE INDEX idx_partner_rate_carrier ON partner_rate(partner_id, delivery_type, carrier)
    WHERE carrier IS NOT NULL;
