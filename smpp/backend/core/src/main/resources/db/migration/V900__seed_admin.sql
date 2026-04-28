-- V900__seed_admin.sql
-- Seed default admin user for bootstrap.
-- Default password: Admin@123456  (change immediately after first login in production)
-- Hash: BCryptPasswordEncoder(cost=10)

INSERT INTO admin_user (username, password_hash, role, partner_id, enabled)
VALUES (
    'admin',
    '$2a$10$osVwv7ByH9o76M4tlC4EVuQc6BiP3Fn9b4EzABOZzb0IlmOCxHL7.',
    'ADMIN',
    NULL,
    TRUE
)
ON CONFLICT (username) DO NOTHING;
