-- Soft delete flag for partner. is_deleted = true → ẩn khỏi admin UI nhưng dữ liệu vẫn còn.
ALTER TABLE partner ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false;

-- Index hỗ trợ filter is_deleted = false (chiếm phần lớn truy vấn).
CREATE INDEX idx_partner_is_deleted ON partner (is_deleted) WHERE is_deleted = false;
