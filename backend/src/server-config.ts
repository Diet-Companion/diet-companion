/** Environment config for the production entry point (ADR-004/C-006, ADR-006/C-005). Errors name variables, never values. */

export interface ServerConfig {
  port: number;
  databaseUrl: string;
  ownerPasswordHash: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const REQUIRED = ["PORT", "DATABASE_URL", "OWNER_PASSWORD_HASH"] as const;

function present(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim() === "" ? undefined : value;
}

/** Parses the environment. Throws ConfigError listing every missing or invalid variable by name only. */
export function parseServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const missing = REQUIRED.filter((name) => present(env[name]) === undefined);
  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
  const rawPort = (env.PORT ?? "").trim();
  const port = /^\d+$/.test(rawPort) ? Number(rawPort) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("PORT must be an integer from 1 to 65535");
  }
  return {
    port,
    databaseUrl: env.DATABASE_URL ?? "",
    ownerPasswordHash: env.OWNER_PASSWORD_HASH ?? "",
  };
}
