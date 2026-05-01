import { scrypt, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

const SALT_BYTES = 64;
const HASH_BYTES = 64;
const TOKEN_BYTES = 32;

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(SALT_BYTES);
    scrypt(password, salt, HASH_BYTES, (err, hash) => {
      if (err) {
        reject(err);
        return;
      }
      const saltHex = salt.toString('hex');
      const hashHex = (hash as Buffer).toString('hex');
      resolve(`scrypt:${saltHex}:${hashHex}`);
    });
  });
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }

  const [, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expectedHash = Buffer.from(hashHex, 'hex');

  try {
    const computedHash = await scryptAsync(password, salt, HASH_BYTES) as Buffer;
    if (computedHash.length !== expectedHash.length) {
      return false;
    }
    return timingSafeEqual(computedHash, expectedHash);
  } catch {
    return false;
  }
}

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
