import { expect, test } from "vitest";
import { ConfigError, parseServerConfig } from "./server-config.js";

const FAKE_URL = "postgres://tester:synthetic-secret-1@/testdb?host=/cloudsql/fake";
const FAKE_HASH = "synthetic-hash-value-2";

// characterization
test("parses a complete environment", () => {
  const config = parseServerConfig({ PORT: "8080", DATABASE_URL: FAKE_URL, OWNER_PASSWORD_HASH: FAKE_HASH });
  expect(config).toEqual({ port: 8080, databaseUrl: FAKE_URL, ownerPasswordHash: FAKE_HASH });
});

// characterization
test("reports every missing variable by name", () => {
  expect(() => parseServerConfig({})).toThrow("PORT, DATABASE_URL, OWNER_PASSWORD_HASH");
  expect(() => parseServerConfig({ PORT: "8080", DATABASE_URL: FAKE_URL })).toThrow("OWNER_PASSWORD_HASH");
});

// characterization
test("treats blank values as missing", () => {
  expect(() => parseServerConfig({ PORT: "8080", DATABASE_URL: "   ", OWNER_PASSWORD_HASH: FAKE_HASH })).toThrow(
    ConfigError,
  );
});

// characterization
test("never prints a value in the error message", () => {
  let message = "";
  try {
    parseServerConfig({ PORT: "abc", DATABASE_URL: FAKE_URL, OWNER_PASSWORD_HASH: FAKE_HASH });
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  expect(message).not.toBe("");
  expect(message).not.toContain(FAKE_URL);
  expect(message).not.toContain(FAKE_HASH);
  expect(message).not.toContain("abc");
});

// characterization
test("rejects a non-numeric port without echoing it", () => {
  expect(() => parseServerConfig({ PORT: "80x80", DATABASE_URL: FAKE_URL, OWNER_PASSWORD_HASH: FAKE_HASH })).toThrow(
    "PORT must be an integer",
  );
});

// characterization
test("rejects a port out of range", () => {
  for (const port of ["0", "65536"]) {
    expect(() => parseServerConfig({ PORT: port, DATABASE_URL: FAKE_URL, OWNER_PASSWORD_HASH: FAKE_HASH })).toThrow(
      ConfigError,
    );
  }
});
