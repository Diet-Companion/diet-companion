import { describe, expect, it } from "vitest";
import { ConfigError } from "./server-config.js";
import { parseOwnerTimeZone, todayIn } from "./today.js";

const ROME = "Europe/Rome";

describe("todayIn", () => {
  // cites: REQ-009/AC-005, ADR-016/C-001
  it("starts the day at local midnight in winter, offset +01:00", () => {
    expect(todayIn(new Date("2026-01-15T22:59:59.000Z"), ROME)).toBe("2026-01-15");
    expect(todayIn(new Date("2026-01-15T23:00:00.000Z"), ROME)).toBe("2026-01-16");
  });

  // cites: REQ-009/AC-005, ADR-016/C-001
  it("starts the day at local midnight in summer, offset +02:00", () => {
    expect(todayIn(new Date("2026-07-15T21:59:59.000Z"), ROME)).toBe("2026-07-15");
    expect(todayIn(new Date("2026-07-15T22:00:00.000Z"), ROME)).toBe("2026-07-16");
  });

  // cites: ADR-016/C-001
  it("follows the configured zone, not the server's", () => {
    const instant = new Date("2026-01-15T23:30:00.000Z");
    expect(todayIn(instant, "UTC")).toBe("2026-01-15");
    expect(todayIn(instant, ROME)).toBe("2026-01-16");
  });
});

describe("parseOwnerTimeZone", () => {
  // cites: ADR-016/C-002
  it("returns a valid IANA zone", () => {
    expect(parseOwnerTimeZone({ OWNER_TIME_ZONE: ROME })).toBe(ROME);
  });

  // cites: ADR-016/C-002
  it("refuses a missing or blank variable, naming it", () => {
    expect(() => parseOwnerTimeZone({})).toThrow(ConfigError);
    expect(() => parseOwnerTimeZone({ OWNER_TIME_ZONE: "  " })).toThrow(/OWNER_TIME_ZONE/);
  });

  // cites: ADR-016/C-002
  it("refuses a name that is not an IANA zone", () => {
    expect(() => parseOwnerTimeZone({ OWNER_TIME_ZONE: "Mars/Olympus" })).toThrow(ConfigError);
    expect(() => parseOwnerTimeZone({ OWNER_TIME_ZONE: "+01:00" })).toThrow(ConfigError);
  });
});
