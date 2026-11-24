-- 003: the fuller product record (IF-001@1.1.0, REQ-002). Forward-only (ADR-008/C-001).
-- Every column is nullable with no default and refuses a negative value, so existing rows and the
-- previous revision keep working (ADR-008/C-002). Sodium is computed on read, never stored (R-001).
-- No constraint ties portion_size_g and portion_calories together.
ALTER TABLE products
  ADD COLUMN carbohydrate double precision CHECK (carbohydrate >= 0),
  ADD COLUMN sugars double precision CHECK (sugars >= 0),
  ADD COLUMN fibre double precision CHECK (fibre >= 0),
  ADD COLUMN salt double precision CHECK (salt >= 0),
  ADD COLUMN portion_size_g double precision CHECK (portion_size_g >= 0),
  ADD COLUMN portion_calories double precision CHECK (portion_calories >= 0),
  ADD COLUMN piece_weight_g double precision CHECK (piece_weight_g >= 0);
