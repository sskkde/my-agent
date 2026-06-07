/**
 * Production Configuration Guard Tests
 *
 * Validates that checkProductionConfig() correctly refuses to start
 * when NODE_ENV=production and critical security config is missing/invalid,
 * while remaining a silent no-op in non-production environments.
 */

import { describe, it, expect } from 'vitest'
import { checkProductionConfig } from '../../src/config/production-guard.js'

function validProductionEnv(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    APP_SECRET_KEY: 'a-very-long-and-secure-production-secret-key-32chars',
    API_AUTH_TOKEN: 'prod-auth-token-12345',
    ALLOWED_ORIGINS: 'https://app.example.com,https://admin.example.com',
    DATABASE_PATH: '/data/app.db',
    LOG_LEVEL: 'info',
    BACKUP_DIR: '/backups',
    PUBLIC_BASE_URL: 'https://app.example.com',
    COOKIE_SECURE: 'true',
    TRUST_PROXY: '1',
  }
}

describe('Production Configuration Guard', () => {
  describe('non-production environments', () => {
    it('should pass without errors when NODE_ENV is not production, even with missing config', () => {
      const result = checkProductionConfig({ NODE_ENV: 'development' })
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('should pass when NODE_ENV is undefined', () => {
      const result = checkProductionConfig({})
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('should pass when NODE_ENV is "test"', () => {
      const result = checkProductionConfig({ NODE_ENV: 'test' })
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([])
    })
  })

  describe('APP_SECRET_KEY validation', () => {
    it('should return error when APP_SECRET_KEY is missing in production', () => {
      const env = validProductionEnv()
      delete env.APP_SECRET_KEY
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('APP_SECRET_KEY is required')]))
    })

    it('should return error when APP_SECRET_KEY is shorter than 32 characters', () => {
      const env = validProductionEnv()
      env.APP_SECRET_KEY = 'too-short-key'
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('at least 32 characters')]))
    })

    it('should return error when APP_SECRET_KEY is a placeholder value', () => {
      const env = validProductionEnv()
      env.APP_SECRET_KEY = 'your_secret_key_that_is_long_enough_but_placeholder'
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('placeholder')]))
    })
  })

  describe('ALLOWED_ORIGINS validation', () => {
    it('should return error when ALLOWED_ORIGINS is wildcard in production', () => {
      const env = validProductionEnv()
      env.ALLOWED_ORIGINS = '*'
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('must not be "*"')]))
    })

    it('should return error when ALLOWED_ORIGINS is not set', () => {
      const env = validProductionEnv()
      delete env.ALLOWED_ORIGINS
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('ALLOWED_ORIGINS is required')]))
    })
  })

  describe('LOG_LEVEL validation', () => {
    it('should return error when LOG_LEVEL is "debug" in production', () => {
      const env = validProductionEnv()
      env.LOG_LEVEL = 'debug'
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('must not be "debug"')]))
    })

    it('should pass when LOG_LEVEL is "info"', () => {
      const env = validProductionEnv()
      env.LOG_LEVEL = 'info'
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(true)
    })

    it('should pass when LOG_LEVEL is not set', () => {
      const env = validProductionEnv()
      delete env.LOG_LEVEL
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(true)
    })
  })

  describe('authentication method validation', () => {
    it('should return error when no auth method is configured', () => {
      const env = validProductionEnv()
      delete env.API_AUTH_TOKEN
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('authentication method')]))
    })

    it('should pass when API_KEY_BOOTSTRAP is set instead of API_AUTH_TOKEN', () => {
      const env = validProductionEnv()
      delete env.API_AUTH_TOKEN
      env.API_KEY_BOOTSTRAP = 'bootstrap-key-for-admin'
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(true)
    })
  })

  describe('database validation', () => {
    it('should return error when neither DATABASE_URL nor DATABASE_PATH is set', () => {
      const env = validProductionEnv()
      delete env.DATABASE_PATH
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('DATABASE_URL or DATABASE_PATH')]))
    })

    it('should pass when DATABASE_URL is set instead of DATABASE_PATH', () => {
      const env = validProductionEnv()
      delete env.DATABASE_PATH
      env.DATABASE_URL = 'postgresql://user:pass@host/db'
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(true)
    })
  })

  describe('COOKIE_SECURE validation', () => {
    it('should return error when COOKIE_SECURE is not "true" and PUBLIC_BASE_URL is HTTPS', () => {
      const env = validProductionEnv()
      env.COOKIE_SECURE = 'false'
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('COOKIE_SECURE must be "true"')]))
    })

    it('should not return error when COOKIE_SECURE is not "true" and PUBLIC_BASE_URL is HTTP', () => {
      const env = validProductionEnv()
      env.COOKIE_SECURE = 'false'
      env.PUBLIC_BASE_URL = 'http://app.example.com'
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(true)
      expect(result.errors).not.toEqual(expect.arrayContaining([expect.stringContaining('COOKIE_SECURE')]))
    })

    it('should return error when COOKIE_SECURE is not set and PUBLIC_BASE_URL is HTTPS', () => {
      const env = validProductionEnv()
      delete env.COOKIE_SECURE
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('COOKIE_SECURE must be "true"')]))
    })
  })

  describe('TRUST_PROXY validation', () => {
    it('should return error when TRUST_PROXY is not set', () => {
      const env = validProductionEnv()
      delete env.TRUST_PROXY
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('TRUST_PROXY must be explicitly configured')]),
      )
    })
  })

  describe('PUBLIC_BASE_URL validation', () => {
    it('should return error when PUBLIC_BASE_URL is not set', () => {
      const env = validProductionEnv()
      delete env.PUBLIC_BASE_URL
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('PUBLIC_BASE_URL is required')]))
    })

    it('should return error when PUBLIC_BASE_URL is not a valid URL', () => {
      const env = validProductionEnv()
      env.PUBLIC_BASE_URL = 'not-a-url'
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('valid HTTP or HTTPS URL')]))
    })
  })

  describe('BACKUP_DIR validation', () => {
    it('should return error when BACKUP_DIR is not set', () => {
      const env = validProductionEnv()
      delete env.BACKUP_DIR
      const result = checkProductionConfig(env)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('BACKUP_DIR is required')]))
    })
  })

  describe('full valid production config', () => {
    it('should pass with all required env vars properly set', () => {
      const result = checkProductionConfig(validProductionEnv())
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([])
    })
  })

  describe('error accumulation', () => {
    it('should collect ALL errors rather than failing on the first one', () => {
      const result = checkProductionConfig({ NODE_ENV: 'production' })
      expect(result.ok).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(5)
    })
  })
})
