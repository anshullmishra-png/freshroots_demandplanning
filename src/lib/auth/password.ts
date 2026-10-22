import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt with a random salt per password. Stored as `scrypt$N$r$p$salt$hash` (base64). Never the password.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 10;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Always do the same work, even for an unknown user, so response time does not reveal who has an account.
  const hash = stored && stored.startsWith("scrypt$") ? stored : DUMMY_HASH;
  const [, n, r, p, saltB64, keyB64] = hash.split("$");
  const expected = Buffer.from(keyB64, "base64");
  const actual = await derive(password, Buffer.from(saltB64, "base64"), Number(n), Number(r), Number(p));
  const match = actual.length === expected.length && timingSafeEqual(actual, expected);
  return match && hash === stored;
}

// A valid hash of a random password nobody knows.
const DUMMY_HASH = ["scrypt", N, R, P, Buffer.alloc(16, 1).toString("base64"), Buffer.alloc(KEY_LENGTH, 2).toString("base64")].join("$");
