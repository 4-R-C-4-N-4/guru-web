-- 010_add_currency_to_users.sql
-- Add currency column to users table with default 'USD'

ALTER TABLE users ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD';
