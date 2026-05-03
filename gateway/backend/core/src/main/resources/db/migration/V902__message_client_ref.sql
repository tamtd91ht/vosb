-- Idempotency key cho partner submit. Cùng (partner_id, client_ref) → message duy nhất.
ALTER TABLE message ADD COLUMN client_ref VARCHAR(64);

-- Partial unique index: chỉ enforce khi client_ref khác null.
CREATE UNIQUE INDEX idx_message_partner_client_ref
    ON message (partner_id, client_ref)
    WHERE client_ref IS NOT NULL;
