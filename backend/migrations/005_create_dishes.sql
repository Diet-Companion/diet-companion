-- 005: dishes and dish lines (ADR-012 option a, REQ-006). Forward-only (ADR-008/C-001).
-- Only new tables, so the previous revision keeps working (ADR-008/C-002).
-- A dish is selectable when replaced_by and deleted_at are both null (ADR-012/C-003).
-- There is no unique index on dishes.name: two dishes may share a name (R-010).
CREATE TABLE dishes (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  replaced_by text REFERENCES dishes (id) DEFERRABLE INITIALLY DEFERRED,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  CONSTRAINT dishes_replaced_or_deleted CHECK (replaced_by IS NULL OR deleted_at IS NULL)
);

-- A line keeps the exact product id it was saved with (R-009). Exactly one of grams and pieces is set,
-- and it is above 0 (A-023). Lines are written only with their dish and never updated (ADR-012/C-002).
CREATE TABLE dish_lines (
  dish_id text NOT NULL REFERENCES dishes (id),
  position integer NOT NULL CHECK (position >= 0),
  product_id text NOT NULL REFERENCES products (id),
  grams numeric CHECK (grams > 0),
  pieces numeric CHECK (pieces > 0),
  PRIMARY KEY (dish_id, position),
  CONSTRAINT dish_lines_one_amount CHECK ((grams IS NULL) <> (pieces IS NULL))
);

CREATE INDEX dish_lines_product_id_idx ON dish_lines (product_id);
