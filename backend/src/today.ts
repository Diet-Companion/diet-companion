import { ConfigError } from "./server-config.js";

/** The deployment setting that names the Owner's IANA time zone (ADR-016/C-002). */
export const TIME_ZONE_VARIABLE = "OWNER_TIME_ZONE";

function isIanaZone(zone: string): boolean {
  // Offsets such as +01:00 are accepted by Intl but are not IANA names.
  if (/^[+-]/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Reads the Owner time zone. Throws ConfigError when it is missing or not a valid IANA zone (ADR-016/C-002). */
export function parseOwnerTimeZone(env: Record<string, string | undefined>): string {
  const zone = env[TIME_ZONE_VARIABLE]?.trim() ?? "";
  if (zone === "") {
    throw new ConfigError(`Missing required environment variable(s): ${TIME_ZONE_VARIABLE}`);
  }
  if (!isIanaZone(zone)) {
    throw new ConfigError(`${TIME_ZONE_VARIABLE} must be a valid IANA time zone name`);
  }
  return zone;
}

/**
 * Today as YYYY-MM-DD: the date of the instant in the Owner zone. The day starts at local 00:00 (ADR-016/C-001).
 * The only place where today is computed; the instant comes from the injectable clock.
 */
export function todayIn(now: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
