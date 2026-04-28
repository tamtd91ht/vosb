-- V4__add_route_carrier.sql
-- Purpose: Add carrier column to route table to support carrier-based routing
--          (e.g. "all VIETTEL traffic from partner X → channel Y"), in addition to
--          the existing prefix-based routing. The two modes are mutually exclusive per row:
--            carrier IS NOT NULL → carrier-based route (msisdn_prefix is informational only)
--            carrier IS NULL     → prefix-based route  (original behaviour, unchanged)
-- Linked: data-model.md §2.5; routing.md carrier hybrid logic.

-- =============================================================================
-- SECTION 1: Drop existing unique constraint on route
-- =============================================================================

-- The V1 unnamed UNIQUE (partner_id, msisdn_prefix, priority) becomes the system-generated
-- constraint name below. We replace it with two partial unique indexes so that
-- carrier-based rows and prefix-based rows each have their own distinct uniqueness domain.

ALTER TABLE route
    DROP CONSTRAINT route_partner_id_msisdn_prefix_priority_key;

-- =============================================================================
-- SECTION 2: Add carrier column
-- =============================================================================

-- NULL  = prefix-based route (legacy, backward-compatible).
-- NOT NULL = carrier-based route; value must be a canonical carrier name
--            (VIETTEL / MOBIFONE / VINAPHONE / VIETNAMOBILE / GMOBILE / REDDI).

ALTER TABLE route
    ADD COLUMN carrier VARCHAR(20);

COMMENT ON COLUMN route.carrier IS
    'Carrier-based routing target (VIETTEL/MOBIFONE/…). NOT NULL = match by carrier; NULL = match by msisdn_prefix.';

-- =============================================================================
-- SECTION 3: Partial unique indexes replacing the dropped constraint
-- =============================================================================

-- Carrier-based uniqueness: one active route row per (partner, carrier).
CREATE UNIQUE INDEX route_partner_carrier_uidx
    ON route (partner_id, carrier)
    WHERE carrier IS NOT NULL;

-- Prefix-based uniqueness: preserves original semantics (partner + prefix + priority).
CREATE UNIQUE INDEX route_partner_prefix_priority_uidx
    ON route (partner_id, msisdn_prefix, priority)
    WHERE carrier IS NULL;

-- =============================================================================
-- SECTION 4: Lookup index for carrier-based route resolution
-- =============================================================================

CREATE INDEX idx_route_carrier
    ON route (partner_id, carrier)
    WHERE carrier IS NOT NULL;
