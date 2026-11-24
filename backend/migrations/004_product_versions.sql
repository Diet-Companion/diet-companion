-- 004: product versions and soft delete (ADR-010 option a, REQ-005). Forward-only (ADR-008/C-001).
-- replaced_by: id of the newer version after a nutrient edit (R-004). deleted_at: soft delete (R-006).
-- A product is selectable when both are null, so every existing row stays selectable.
-- Only nullable columns are added, so the previous revision keeps working (ADR-008/C-002).
ALTER TABLE products
  ADD COLUMN replaced_by text REFERENCES products (id) DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN deleted_at timestamptz,
  ADD CONSTRAINT products_replaced_or_deleted CHECK (replaced_by IS NULL OR deleted_at IS NULL);

-- R-003 now binds selectable rows only. Same index name and same normalised expressions as 001, so the
-- backend still maps a violation of products_name_shop_key to product.duplicate_name_shop.
DROP INDEX products_name_shop_key;
CREATE UNIQUE INDEX products_name_shop_key ON products (
  (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))),
  (lower(btrim(regexp_replace(shop, '\s+', ' ', 'g'))))
) WHERE replaced_by IS NULL AND deleted_at IS NULL;
