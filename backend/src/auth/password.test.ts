import { describe, expect, it } from "vitest";
import { hashPassword, ownerPasswordHashFromEnv, verifyPassword } from "./password.js";

const FAST = { N: 1024, r: 8, p: 1 };
const PASSWORD = "synthetic-test-password";

describe("owner password hash", () => {
  // cites: IF-001@1.0.0#loginOwner
  it("verifies the right password and refuses a wrong one", async () => {
    const hash = await hashPassword(PASSWORD, FAST);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword("another-synthetic-password", hash)).toBe(false);
  });

  // cites: IF-001@1.0.0#loginOwner
  it("does not contain the password and is salted", async () => {
    const a = await hashPassword(PASSWORD, FAST);
    const b = await hashPassword(PASSWORD, FAST);
    expect(a.startsWith("scrypt$1024$8$1$")).toBe(true);
    expect(a).not.toContain(PASSWORD);
    expect(a).not.toBe(b);
  });

  // cites: IF-001@1.0.0#loginOwner
  it("treats a malformed hash as a failed check", async () => {
    expect(await verifyPassword(PASSWORD, "")).toBe(false);
    expect(await verifyPassword(PASSWORD, "plain-text")).toBe(false);
    expect(await verifyPassword(PASSWORD, "scrypt$3$8$1$AAAA$AAAA")).toBe(false);
  });

  // cites: IF-001@1.0.0#loginOwner
  it("reads the hash from OWNER_PASSWORD_HASH and treats empty as unset", () => {
    expect(ownerPasswordHashFromEnv({ OWNER_PASSWORD_HASH: "abc" })).toBe("abc");
    expect(ownerPasswordHashFromEnv({ OWNER_PASSWORD_HASH: "" })).toBeUndefined();
    expect(ownerPasswordHashFromEnv({})).toBeUndefined();
  });
});
