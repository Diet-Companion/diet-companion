-- 006: daily target ranges (ADR-015 option a, REQ-009). Forward-only (ADR-008/C-001).
-- Only a new table and no rows, so the previous revision keeps working (ADR-008/C-002, ADR-015/C-001).
-- One row per nutrient and effective date. The range in force on X is the row with the greatest
-- effective_from not after X (ADR-015/C-003). Limits are whole numbers from 0 upward (R-011).
CREATE TABLE target_ranges (
  nutrient text NOT NULL CHECK (nutrient IN ('calories', 'protein', 'fat')),
  effective_from date NOT NULL,
  minimum integer NOT NULL CHECK (minimum >= 0),
  maximum integer NOT NULL CHECK (maximum >= minimum),
  PRIMARY KEY (nutrient, effective_from)
);
