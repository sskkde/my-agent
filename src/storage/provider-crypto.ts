import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

export interface EncryptedSecret {
  encrypted: string
  iv: string
  authTag: string
}

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super('APP_SECRET_KEY environment variable is required for encrypting provider API keys')
    this.name = 'MissingEncryptionKeyError'
  }
}

export class DecryptionError extends Error {
  constructor(message: string) {
    super(`Decryption failed: ${message}`)
    this.name = 'DecryptionError'
  }
}

export function getEncryptionKey(): Buffer {
  const secretKey = process.env.APP_SECRET_KEY
  if (!secretKey) {
    throw new MissingEncryptionKeyError()
  }
  return createHash('sha256').update(secretKey).digest()
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  }
}

export function decryptSecret(encrypted: string, iv: string, authTag: string): string {
  const key = getEncryptionKey()

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'))
    decipher.setAuthTag(Buffer.from(authTag, 'hex'))

    const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'hex')), decipher.final()])

    return decrypted.toString('utf8')
  } catch (error) {
    throw new DecryptionError(error instanceof Error ? error.message : 'Unknown error')
  }
}

export function serializeEncryptedSecret(encrypted: EncryptedSecret): string {
  return `${ALGORITHM}:${encrypted.iv}:${encrypted.authTag}:${encrypted.encrypted}`
}

export function deserializeEncryptedSecret(serialized: string): EncryptedSecret {
  const parts = serialized.split(':')
  if (parts.length !== 4 || parts[0] !== ALGORITHM) {
    throw new DecryptionError('Invalid encrypted secret format')
  }
  return {
    iv: parts[1],
    authTag: parts[2],
    encrypted: parts[3],
  }
}
