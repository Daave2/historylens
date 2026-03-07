-- phase6_categories.sql
-- Removes the hard-coded category CHECK constraint from the places table
-- so that it can accept dynamic string types (e.g. "Church", "Pub")

ALTER TABLE places DROP CONSTRAINT IF EXISTS places_category_check;
