import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, generateSessionToken, hashToken } from '../../src/storage/auth-crypto.js'

describe('auth-crypto', () => {
  describe('hashPassword', () => {
    it('should return a string in the correct format', async () => {
      const result = await hashPassword('test-password')
      expect(result).toContain('scrypt:')
      const parts = result.split(':')
      expect(parts.length).toBe(3)
      expect(parts[0]).toBe('scrypt')
      expect(parts[1].length).toBe(128)
      expect(parts[2].length).toBe(128)
    })

    it('should produce different hashes for the same password (due to random salt)', async () => {
      const password = 'same-password'
      const hash1 = await hashPassword(password)
      const hash2 = await hashPassword(password)
      expect(hash1).not.toBe(hash2)
    })

    it('should handle empty passwords', async () => {
      const result = await hashPassword('')
      expect(result).toContain('scrypt:')
      const parts = result.split(':')
      expect(parts.length).toBe(3)
    })

    it('should handle long passwords', async () => {
      const longPassword = 'a'.repeat(1000)
      const result = await hashPassword(longPassword)
      expect(result).toContain('scrypt:')
      const parts = result.split(':')
      expect(parts.length).toBe(3)
    })

    it('should handle passwords with special characters', async () => {
      const specialPassword = '!@#$%^&*()_+-=[]{}|;:,.<>?`~"\'\\'
      const result = await hashPassword(specialPassword)
      expect(result).toContain('scrypt:')
      const parts = result.split(':')
      expect(parts.length).toBe(3)
    })
  })

  describe('verifyPassword', () => {
    it('should return true for correct password', async () => {
      const password = 'correct-password'
      const hash = await hashPassword(password)
      const result = await verifyPassword(password, hash)
      expect(result).toBe(true)
    })

    it('should return false for incorrect password', async () => {
      const password = 'correct-password'
      const hash = await hashPassword(password)
      const result = await verifyPassword('wrong-password', hash)
      expect(result).toBe(false)
    })

    it('should return false for empty password when hash is for non-empty', async () => {
      const hash = await hashPassword('non-empty')
      const result = await verifyPassword('', hash)
      expect(result).toBe(false)
    })

    it('should return true for empty password when hash is for empty', async () => {
      const hash = await hashPassword('')
      const result = await verifyPassword('', hash)
      expect(result).toBe(true)
    })

    it('should return false for invalid hash format (wrong prefix)', async () => {
      const result = await verifyPassword('password', 'bcrypt:salt:hash')
      expect(result).toBe(false)
    })

    it('should return false for invalid hash format (missing parts)', async () => {
      const result = await verifyPassword('password', 'scrypt:salt')
      expect(result).toBe(false)
    })

    it('should return false for empty hash', async () => {
      const result = await verifyPassword('password', '')
      expect(result).toBe(false)
    })

    it('should be timing-safe (not throw on different length hashes)', async () => {
      const password = 'test'
      const hash = await hashPassword(password)
      const result = await verifyPassword(password, hash)
      expect(result).toBe(true)
    })
  })

  describe('generateSessionToken', () => {
    it('should return a 64-character hex string', () => {
      const token = generateSessionToken()
      expect(token.length).toBe(64)
      expect(/^[a-f0-9]+$/.test(token)).toBe(true)
    })

    it('should generate unique tokens', () => {
      const tokens = new Set<string>()
      for (let i = 0; i < 100; i++) {
        tokens.add(generateSessionToken())
      }
      expect(tokens.size).toBe(100)
    })
  })

  describe('hashToken', () => {
    it('should return a 64-character hex string (SHA-256)', () => {
      const token = 'test-token'
      const hash = hashToken(token)
      expect(hash.length).toBe(64)
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true)
    })

    it('should return consistent hash for same input', () => {
      const token = 'consistent-token'
      const hash1 = hashToken(token)
      const hash2 = hashToken(token)
      expect(hash1).toBe(hash2)
    })

    it('should return different hashes for different inputs', () => {
      const hash1 = hashToken('token1')
      const hash2 = hashToken('token2')
      expect(hash1).not.toBe(hash2)
    })

    it('should handle empty string', () => {
      const hash = hashToken('')
      expect(hash.length).toBe(64)
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true)
    })
  })

  describe('integration: token workflow', () => {
    it('should generate, hash, and verify tokens correctly', async () => {
      const token = generateSessionToken()
      const tokenHash = hashToken(token)

      expect(token).toBeDefined()
      expect(tokenHash).toBeDefined()
      expect(token.length).toBe(64)
      expect(tokenHash.length).toBe(64)

      const sameTokenHash = hashToken(token)
      expect(tokenHash).toBe(sameTokenHash)

      const differentToken = generateSessionToken()
      const differentHash = hashToken(differentToken)
      expect(differentHash).not.toBe(tokenHash)
    })

    it('should hash and verify passwords correctly', async () => {
      const password = 'my-secret-password'
      const hashed = await hashPassword(password)
      const isValid = await verifyPassword(password, hashed)
      expect(isValid).toBe(true)
    })
  })
})
