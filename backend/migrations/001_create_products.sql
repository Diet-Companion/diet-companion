-- 001: the products table (IF-001 NewProduct fields).
-- R-002: required values are NOT NULL (blank text is refused too).
-- R-003: no two products with the same name and shop, compared ignoring letter case and
-- leading, trailing or repeated spaces. Every row is selectable until soft delete (R-006) exists.
CREATE TABLE products (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  shop text NOT NULL CHECK (btrim(shop) <> ''),
  calories double precision NOT NULL CHECK (calories >= 0),
  protein double precision NOT NULL CHECK (protein >= 0),
  fat double precision NOT NULL CHECK (fat >= 0),
  brand text,
  source text NOT NULL CHECK (source IN ('label', 'lookup', 'manual'))
);

CREATE UNIQUE INDEX products_name_shop_key ON products (
  (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))),
  (lower(btrim(regexp_replace(shop, '\s+', ' ', 'g'))))
);
