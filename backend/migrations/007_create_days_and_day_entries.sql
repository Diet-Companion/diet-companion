-- 007: the day record and the entries of the day plan and the meal log (ADR-017 option a, ADR-019 option a;
-- REQ-013, REQ-014). Forward-only (ADR-008/C-001). Only new tables, so the previous revision keeps working (ADR-008/C-002).
-- closed_at is written only by the closing feature of REQ-011, which is not built; until then it stays null (ADR-019/C-002).
CREATE TABLE days (
  day date PRIMARY KEY,
  closed_at timestamptz,
  created_at timestamptz NOT NULL
);

-- One table for plan and log rows (ADR-017/C-001). An entry keeps the exact product or dish id for life (R-009):
-- there is no cascade, so replacing or soft-deleting a product or dish never touches an entry.
CREATE TABLE day_entries (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('plan', 'log')),
  day date NOT NULL REFERENCES days (day),
  meal text NOT NULL CHECK (meal IN ('breakfast', 'brunch', 'lunch', 'afternoon_snack', 'dinner')),
  position integer NOT NULL CHECK (position >= 0),
  product_id text REFERENCES products (id),
  dish_id text REFERENCES dishes (id),
  grams integer CHECK (grams > 0),
  pieces integer CHECK (pieces > 0),
  from_dish_id text REFERENCES dishes (id),
  created_at timestamptz NOT NULL,
  CONSTRAINT day_entries_one_subject CHECK ((product_id IS NULL) <> (dish_id IS NULL)),
  CONSTRAINT day_entries_product_one_amount CHECK (product_id IS NULL OR ((grams IS NULL) <> (pieces IS NULL))),
  CONSTRAINT day_entries_dish_no_amount CHECK (dish_id IS NULL OR (grams IS NULL AND pieces IS NULL)),
  CONSTRAINT day_entries_from_dish_on_product CHECK (from_dish_id IS NULL OR product_id IS NOT NULL),
  CONSTRAINT day_entries_position_unique UNIQUE (kind, day, meal, position)
);

CREATE INDEX day_entries_kind_day_idx ON day_entries (kind, day);
