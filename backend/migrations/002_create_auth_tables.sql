-- 002: Owner sessions and login throttle state (ADR-004 option d, C-007, C-008).
-- id is the SHA-256 (hex) of the opaque cookie value, never the cookie value itself.
CREATE TABLE owner_sessions (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

CREATE INDEX owner_sessions_expires_at_idx ON owner_sessions (expires_at);

-- One row per throttle key; failures counts within the window that began at window_start.
CREATE TABLE login_throttle (
  key text PRIMARY KEY,
  failures integer NOT NULL CHECK (failures >= 0),
  window_start timestamptz NOT NULL
);
