-- V5__seed_carrier_prefix.sql
-- Purpose: Ensure all Vietnamese domestic carrier prefix rows exist in carrier_prefix.
--          Uses ON CONFLICT DO NOTHING so this migration is safe to apply even if V3
--          already populated the table (e.g. environments that ran V3 before this seed
--          was formalised as a standalone step).
-- Source: Bộ TT&TT Việt Nam — quy hoạch số E.164 084xx (MIC numbering plan 2024).
-- Total: 32 prefix rows covering 6 carriers.

-- carrier_prefix schema (created in V3):
--   prefix  VARCHAR(8)  PRIMARY KEY   -- first 4 digits of E.164, e.g. '8432'
--   carrier VARCHAR(20) NOT NULL      -- VIETTEL / MOBIFONE / VINAPHONE / VIETNAMOBILE / GMOBILE / REDDI

-- =============================================================================
-- VIETTEL — 12 prefixes
-- =============================================================================

INSERT INTO carrier_prefix (prefix, carrier) VALUES
    ('8432', 'VIETTEL'),
    ('8433', 'VIETTEL'),
    ('8434', 'VIETTEL'),
    ('8435', 'VIETTEL'),
    ('8436', 'VIETTEL'),
    ('8437', 'VIETTEL'),
    ('8438', 'VIETTEL'),
    ('8439', 'VIETTEL'),
    ('8486', 'VIETTEL'),
    ('8496', 'VIETTEL'),
    ('8497', 'VIETTEL'),
    ('8498', 'VIETTEL')
ON CONFLICT (prefix) DO NOTHING;

-- =============================================================================
-- MOBIFONE — 8 prefixes
-- =============================================================================

INSERT INTO carrier_prefix (prefix, carrier) VALUES
    ('8470', 'MOBIFONE'),
    ('8476', 'MOBIFONE'),
    ('8477', 'MOBIFONE'),
    ('8478', 'MOBIFONE'),
    ('8479', 'MOBIFONE'),
    ('8489', 'MOBIFONE'),
    ('8490', 'MOBIFONE'),
    ('8493', 'MOBIFONE')
ON CONFLICT (prefix) DO NOTHING;

-- =============================================================================
-- VINAPHONE — 8 prefixes
-- =============================================================================

INSERT INTO carrier_prefix (prefix, carrier) VALUES
    ('8481', 'VINAPHONE'),
    ('8482', 'VINAPHONE'),
    ('8483', 'VINAPHONE'),
    ('8484', 'VINAPHONE'),
    ('8485', 'VINAPHONE'),
    ('8488', 'VINAPHONE'),
    ('8491', 'VINAPHONE'),
    ('8494', 'VINAPHONE')
ON CONFLICT (prefix) DO NOTHING;

-- =============================================================================
-- VIETNAMOBILE — 4 prefixes
-- =============================================================================

INSERT INTO carrier_prefix (prefix, carrier) VALUES
    ('8452', 'VIETNAMOBILE'),
    ('8456', 'VIETNAMOBILE'),
    ('8458', 'VIETNAMOBILE'),
    ('8492', 'VIETNAMOBILE')
ON CONFLICT (prefix) DO NOTHING;

-- =============================================================================
-- GMOBILE — 2 prefixes
-- =============================================================================

INSERT INTO carrier_prefix (prefix, carrier) VALUES
    ('8459', 'GMOBILE'),
    ('8499', 'GMOBILE')
ON CONFLICT (prefix) DO NOTHING;

-- =============================================================================
-- REDDI — 1 prefix
-- =============================================================================

INSERT INTO carrier_prefix (prefix, carrier) VALUES
    ('8455', 'REDDI')
ON CONFLICT (prefix) DO NOTHING;
