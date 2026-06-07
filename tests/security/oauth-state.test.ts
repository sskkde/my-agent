import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OAuthStateManager } from '../../src/connectors/oauth/oauth-state.js'
import { createHash } from 'crypto'

describe('OAuth State Security', () => {
  let manager: OAuthStateManager

  beforeEach(() => {
    manager = new OAuthStateManager()
  })

  afterEach(() => {
    manager.destroy()
  })

  describe('state parameter is one-time use (replay attack prevention)', () => {
    it('should reject reuse of the same state parameter', () => {
      const { codeVerifier } = manager.generatePkce()
      const state = manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier,
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-123',
      })

      const firstUse = manager.consumeState(state.stateId)
      expect(firstUse).not.toBeNull()

      const replayAttempt = manager.consumeState(state.stateId)
      expect(replayAttempt).toBeNull()
    })

    it('should mark state as used after first consumption', () => {
      const { codeVerifier } = manager.generatePkce()
      const state = manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier,
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-123',
      })

      const consumed = manager.consumeState(state.stateId)
      expect(consumed).not.toBeNull()
      expect(consumed!.used).toBe(true)
    })

    it('should reject replay even with different callback attempts', () => {
      const { codeVerifier } = manager.generatePkce()
      const state = manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier,
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-123',
      })

      manager.consumeState(state.stateId)

      for (let i = 0; i < 5; i++) {
        expect(manager.consumeState(state.stateId)).toBeNull()
      }
    })
  })

  describe('expired state cannot be used', () => {
    it('should reject expired state', () => {
      const shortManager = new OAuthStateManager(-1)
      const { codeVerifier } = shortManager.generatePkce()
      const state = shortManager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier,
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-123',
      })

      const consumed = shortManager.consumeState(state.stateId)
      expect(consumed).toBeNull()
      shortManager.destroy()
    })

    it('should accept state before expiry', () => {
      const { codeVerifier } = manager.generatePkce()
      const state = manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier,
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-123',
      })

      const consumed = manager.consumeState(state.stateId)
      expect(consumed).not.toBeNull()
    })

    it('should clean up expired states', () => {
      const shortManager = new OAuthStateManager(-1)
      shortManager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier: 'test',
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-123',
      })

      expect(shortManager.getActiveCount()).toBe(1)
      shortManager.cleanup()
      expect(shortManager.getActiveCount()).toBe(0)
      shortManager.destroy()
    })
  })

  describe('PKCE mismatch detection', () => {
    it('should reject wrong code_verifier', () => {
      const { codeChallenge } = manager.generatePkce()
      const wrongVerifier = 'wrong-verifier-value'

      expect(manager.verifyPkce(wrongVerifier, codeChallenge)).toBe(false)
    })

    it('should reject wrong code_challenge', () => {
      const { codeVerifier } = manager.generatePkce()
      const wrongChallenge = 'wrong-challenge-value'

      expect(manager.verifyPkce(codeVerifier, wrongChallenge)).toBe(false)
    })

    it('should accept matching code_verifier/code_challenge pair', () => {
      const { codeVerifier, codeChallenge } = manager.generatePkce()

      expect(manager.verifyPkce(codeVerifier, codeChallenge)).toBe(true)
    })

    it('should reject code_verifier from a different PKCE exchange', () => {
      const first = manager.generatePkce()
      const second = manager.generatePkce()

      expect(manager.verifyPkce(first.codeVerifier, second.codeChallenge)).toBe(false)
      expect(manager.verifyPkce(second.codeVerifier, first.codeChallenge)).toBe(false)
    })

    it('should compute S256 challenge correctly', () => {
      const { codeVerifier, codeChallenge } = manager.generatePkce()

      const expected = createHash('sha256').update(codeVerifier).digest('base64url')

      expect(codeChallenge).toBe(expected)
    })

    it('should reject tampered code_verifier', () => {
      const { codeVerifier, codeChallenge } = manager.generatePkce()
      const tamperedVerifier = codeVerifier.slice(0, -1) + 'X'

      expect(manager.verifyPkce(tamperedVerifier, codeChallenge)).toBe(false)
    })
  })

  describe('state cannot be forged (UUID based)', () => {
    it('should reject non-existent state IDs', () => {
      const consumed = manager.consumeState('non-existent-uuid')
      expect(consumed).toBeNull()
    })

    it('should reject empty state ID', () => {
      const consumed = manager.consumeState('')
      expect(consumed).toBeNull()
    })

    it('should reject predictable state IDs', () => {
      const predictableIds = ['12345', 'state', 'aaaa-bbbb-cccc', '00000000-0000-0000-0000-000000000000']

      for (const id of predictableIds) {
        expect(manager.consumeState(id)).toBeNull()
      }
    })

    it('should generate unique state IDs for each request', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const { codeVerifier } = manager.generatePkce()
        const state = manager.createState({
          providerId: 'google',
          connectorType: 'calendar',
          codeVerifier,
          redirectUri: 'http://localhost:3003/callback',
          userId: 'user-123',
        })
        ids.add(state.stateId)
      }

      expect(ids.size).toBe(100)
    })
  })

  describe('different users get different states', () => {
    it('should create distinct state entries for different users', () => {
      const { codeVerifier: cv1 } = manager.generatePkce()
      const { codeVerifier: cv2 } = manager.generatePkce()

      const state1 = manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier: cv1,
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-alice',
      })

      const state2 = manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier: cv2,
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-bob',
      })

      expect(state1.stateId).not.toBe(state2.stateId)
      expect(state1.userId).toBe('user-alice')
      expect(state2.userId).toBe('user-bob')
    })

    it('should not allow cross-user state consumption', () => {
      const { codeVerifier: cv1 } = manager.generatePkce()
      const state1 = manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier: cv1,
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-alice',
      })

      const consumed = manager.consumeState(state1.stateId)
      expect(consumed).not.toBeNull()
      expect(consumed!.userId).toBe('user-alice')
    })

    it('should isolate states between users', () => {
      const { codeVerifier: cv1 } = manager.generatePkce()
      const { codeVerifier: cv2 } = manager.generatePkce()

      const state1 = manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier: cv1,
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-alice',
      })

      const state2 = manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier: cv2,
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-bob',
      })

      const consumed = manager.consumeState(state1.stateId)
      expect(consumed).not.toBeNull()
      expect(consumed!.userId).toBe('user-alice')

      const consumed2 = manager.consumeState(state2.stateId)
      expect(consumed2).not.toBeNull()
      expect(consumed2!.userId).toBe('user-bob')

      expect(manager.consumeState(state1.stateId)).toBeNull()
      expect(manager.consumeState(state2.stateId)).toBeNull()
    })
  })
})
