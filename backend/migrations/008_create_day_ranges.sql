-- 008: the ranges stored when a day is closed (ADR-020 option a, constraint C-001; REQ-011, REQ-016).
-- Forward-only (ADR-008/C-001). Only a new table, so the previous revision keeps working (ADR-008/C-002).
-- One row per day and nutrient that had a range in force on the date. It inserts no rows and alters nothing.
-- Rows are written only by closeDay and never updated or deleted (ADR-020/C-002).
CREATE TABLE day_ranges (
  day date NOT NULL REFERENCES days (day),
  nutrient text NOT NULL CHECK (nutrient IN ('calories', 'protein', 'fat')),
  minimum integer NOT NULL CHECK (minimum >= 0),
  maximum integer NOT NULL,
  PRIMARY KEY (day, nutrient),
  CONSTRAINT day_ranges_maximum_not_below_minimum CHECK (maximum >= minimum)
);
