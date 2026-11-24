import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/** Salted scrypt hash of the Owner password (ADR-004/C-006). Format: scrypt$N$r$p$salt$hash (base64). */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export const DEFAULT_SCRYPT: ScryptParams = { N: 32768, r: 8, p: 1 };

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, keyLength: number, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const options: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r };
    scrypt(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function validParams(params: ScryptParams): boolean {
  const { N, r, p } = params;
  return (
    Number.isInteger(N) &&
    N >= 2 &&
    N <= 1 << 20 &&
    (N & (N - 1)) === 0 &&
    Number.isInteger(r) &&
    r >= 1 &&
    r <= 32 &&
    Number.isInteger(p) &&
    p >= 1 &&
    p <= 16
  );
}

/** Hashes a password with a fresh random salt (injectable for tests). */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT,
  salt: Buffer = randomBytes(SALT_LENGTH),
): Promise<string> {
  if (!validParams(params)) throw new Error("invalid scrypt parameters");
  const key = await derive(password, salt, KEY_LENGTH, params);
  return ["scrypt", params.N, params.r, params.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** True only for the right password. A malformed hash is false, never an exception. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const params: ScryptParams = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) };
  if (!validParams(params)) return false;
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = await derive(password, salt, expected.length, params);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** The hash comes from hosting configuration, never from the repository. */
export function ownerPasswordHashFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.OWNER_PASSWORD_HASH;
  return value === undefined || value === "" ? undefined : value;
}
