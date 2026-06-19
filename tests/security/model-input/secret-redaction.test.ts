import { describe, it, expect } from 'vitest'
import { createModelInputRedactor } from '../../../src/kernel/model-input/model-input-redactor.js'
import { createModelInputSnapshotStore } from '../../../src/kernel/model-input/model-input-snapshot-store.js'
import type { BuiltModelInput } from '../../../src/kernel/model-input/model-input-types.js'

const SENTINEL_API_KEY = 'sk-or-v1-9876543210abcdefXYZ'
const SENTINEL_OAUTH_TOKEN = 'Bearer eyJhbGciOiJSUzI1NiJ9.abc123'
const SENTINEL_DB_PASSWORD = 'db-pwd-supersecret-2024'
const SENTINEL_PEM_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890abcdef
-----END RSA PRIVATE KEY-----`
const SENTINEL_WEBHOOK_SECRET = 'whsec_abcdef1234567890'
const SENTINEL_AUTH_HEADER = 'Authorization: Bearer sk-or-v1-topsecret'
const SENTINEL_REFRESH_TOKEN = 'refresh-tok-98765-xyz'

function makeBuiltInput(overrides: Record<string, unknown> = {}): BuiltModelInput {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    segments: {
      staticPrefix: 'System prefix',
      tenantProject: 'Tenant instructions',
      toolPlane: 'Tools',
      contextBundle: 'Context',
    },
    segmentHashes: {
      segmentA: 'a'.repeat(64),
      segmentB: 'b'.repeat(64),
      segmentC: 'c'.repeat(64),
      segmentD: 'd'.repeat(64),
    },
    metadata: {
      mode: 'routing_json',
      agentKind: 'foreground',
      providerFamily: 'openai',
      messageCount: 1,
    },
    ...overrides,
  } as BuiltModelInput
}

describe('Secret Redaction Security Tests', () => {
  describe('API keys in snapshots', () => {
    it('redacts API key from key-based field in snapshot', () => {
      const redactor = createModelInputRedactor()
      const store = createModelInputSnapshotStore(redactor)

      const snapshot = store.record({
        agentKind: 'foreground',
        agentType: 'main',
        agentProfile: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput({
          segments: {
            staticPrefix: 'System prefix',
            tenantProject: '',
            toolPlane: '',
            contextBundle: '',
          },
        }),
        response: { apiKey: SENTINEL_API_KEY, name: 'production' },
      })

      expect(snapshot.response!.apiKey).toBe('[REDACTED]')
      expect(snapshot.response!.name).toBe('production')
    })

    it('redacts API key from content-based patterns in strings', () => {
      const redactor = createModelInputRedactor()
      const payload = {
        log: 'api_key: "sk-or-v1-9876543210abcdefXYZ" for production',
        name: 'test',
      }
      const result = redactor.redact(payload)

      expect(result.log).not.toContain(SENTINEL_API_KEY)
      expect(result.log).toContain('[REDACTED]')
      expect(result.name).toBe('test')
    })

    it('redacts apiKey field in nested objects', () => {
      const redactor = createModelInputRedactor()
      const payload = {
        config: { apiKey: SENTINEL_API_KEY, name: 'production' },
      }
      const result = redactor.redact(payload)
      expect(result.config.apiKey).toBe('[REDACTED]')
      expect(result.config.name).toBe('production')
    })
  })

  describe('OAuth tokens in snapshots', () => {
    it('redacts accessToken from key-based field', () => {
      const redactor = createModelInputRedactor()
      const store = createModelInputSnapshotStore(redactor)

      const snapshot = store.record({
        agentKind: 'foreground',
        agentType: 'main',
        agentProfile: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
        response: { accessToken: SENTINEL_OAUTH_TOKEN, userId: 'u1' },
      })

      expect(snapshot.response!.accessToken).toBe('[REDACTED]')
      expect(snapshot.response!.userId).toBe('u1')
    })

    it('redacts token from key-based field', () => {
      const redactor = createModelInputRedactor()
      const payload = { token: SENTINEL_OAUTH_TOKEN, userId: 'u1' }
      const result = redactor.redact(payload)
      expect(result.token).toBe('[REDACTED]')
      expect(result.userId).toBe('u1')
    })

    it('redacts token from content patterns', () => {
      const redactor = createModelInputRedactor()
      const payload = { log: 'token: "Bearer eyJhbGciOiJSUzI1NiJ9.abc123"' }
      const result = redactor.redact(payload)
      expect(result.log).not.toContain('eyJhbGciOiJSUzI1NiJ9')
      expect(result.log).toContain('[REDACTED]')
    })
  })

  describe('database passwords in snapshots', () => {
    it('redacts password from key-based field', () => {
      const redactor = createModelInputRedactor()
      const store = createModelInputSnapshotStore(redactor)

      const snapshot = store.record({
        agentKind: 'kernel',
        agentType: 'main',
        agentProfile: 'default_main',
        mode: 'function_calling',
        builtInput: makeBuiltInput(),
        response: { password: SENTINEL_DB_PASSWORD, host: 'localhost' },
      })

      expect(snapshot.response!.password).toBe('[REDACTED]')
      expect(snapshot.response!.host).toBe('localhost')
    })

    it('redacts password from content patterns', () => {
      const redactor = createModelInputRedactor()
      const payload = { log: 'password: "db-pwd-supersecret-2024"' }
      const result = redactor.redact(payload)
      expect(result.log).not.toContain(SENTINEL_DB_PASSWORD)
      expect(result.log).toContain('[REDACTED]')
    })
  })

  describe('PEM private keys in snapshots', () => {
    it('redacts PEM private key blocks from string content', () => {
      const redactor = createModelInputRedactor()
      const store = createModelInputSnapshotStore(redactor)

      const snapshot = store.record({
        agentKind: 'foreground',
        agentType: 'main',
        agentProfile: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
        response: { certBlock: SENTINEL_PEM_KEY, name: 'test' },
      })

      expect(snapshot.response!.certBlock).not.toContain('BEGIN RSA PRIVATE KEY')
      expect(snapshot.response!.certBlock).toContain('[REDACTED]')
      expect(snapshot.response!.name).toBe('test')
    })

    it('redacts PEM blocks embedded in longer strings', () => {
      const redactor = createModelInputRedactor()
      const payload = {
        config: `ssl_cert = ${SENTINEL_PEM_KEY}`,
        name: 'test',
      }
      const result = redactor.redact(payload)
      expect(result.config).not.toContain('BEGIN RSA PRIVATE KEY')
      expect(result.config).toContain('[REDACTED]')
      expect(result.name).toBe('test')
    })
  })

  describe('authorization headers in snapshots', () => {
    it('redacts authorization from key-based field', () => {
      const redactor = createModelInputRedactor()
      const store = createModelInputSnapshotStore(redactor)

      const snapshot = store.record({
        agentKind: 'foreground',
        agentType: 'main',
        agentProfile: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
        response: { authorization: SENTINEL_AUTH_HEADER, endpoint: '/api' },
      })

      expect(snapshot.response!.authorization).toBe('[REDACTED]')
      expect(snapshot.response!.endpoint).toBe('/api')
    })

    it('redacts authorization from content patterns', () => {
      const redactor = createModelInputRedactor()
      const payload = { log: 'authorization: "Bearer sk-or-v1-topsecret"' }
      const result = redactor.redact(payload)
      expect(result.log).not.toContain('sk-or-v1-topsecret')
      expect(result.log).toContain('[REDACTED]')
    })
  })

  describe('webhook secrets in snapshots', () => {
    it('redacts webhookSecret from key-based field', () => {
      const redactor = createModelInputRedactor()
      const store = createModelInputSnapshotStore(redactor)

      const snapshot = store.record({
        agentKind: 'foreground',
        agentType: 'main',
        agentProfile: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
        response: { webhookSecret: SENTINEL_WEBHOOK_SECRET, url: '/hook' },
      })

      expect(snapshot.response!.webhookSecret).toBe('[REDACTED]')
      expect(snapshot.response!.url).toBe('/hook')
    })

    it('redacts webhook_secret from content patterns', () => {
      const redactor = createModelInputRedactor()
      const payload = { log: 'webhook_secret: "whsec_abcdef1234567890"' }
      const result = redactor.redact(payload)
      expect(result.log).not.toContain(SENTINEL_WEBHOOK_SECRET)
      expect(result.log).toContain('[REDACTED]')
    })
  })

  describe('nested objects with secrets', () => {
    it('redacts secrets in deeply nested structures', () => {
      const redactor = createModelInputRedactor()
      const payload = {
        level1: {
          level2: {
            level3: {
              apiKey: SENTINEL_API_KEY,
              normalData: 'visible',
            },
            password: SENTINEL_DB_PASSWORD,
          },
        },
      }
      const result = redactor.redact(payload)
      expect(result.level1.level2.level3.apiKey).toBe('[REDACTED]')
      expect(result.level1.level2.level3.normalData).toBe('visible')
      expect(result.level1.level2.password).toBe('[REDACTED]')
    })

    it('redacts secrets in arrays within objects', () => {
      const redactor = createModelInputRedactor()
      const payload = {
        connections: [
          { name: 'prod', apiKey: SENTINEL_API_KEY },
          { name: 'dev', token: SENTINEL_OAUTH_TOKEN },
        ],
      }
      const result = redactor.redact(payload)
      expect(result.connections[0].apiKey).toBe('[REDACTED]')
      expect(result.connections[0].name).toBe('prod')
      expect(result.connections[1].token).toBe('[REDACTED]')
      expect(result.connections[1].name).toBe('dev')
    })

    it('redacts all secret types combined in snapshot response', () => {
      const redactor = createModelInputRedactor()
      const store = createModelInputSnapshotStore(redactor)

      const snapshot = store.record({
        agentKind: 'foreground',
        agentType: 'main',
        agentProfile: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
        response: {
          apiKey: SENTINEL_API_KEY,
          oauthToken: SENTINEL_OAUTH_TOKEN,
          dbPassword: SENTINEL_DB_PASSWORD,
          certBlock: SENTINEL_PEM_KEY,
          authHeader: SENTINEL_AUTH_HEADER,
          webhookSecret: SENTINEL_WEBHOOK_SECRET,
          refreshToken: SENTINEL_REFRESH_TOKEN,
          safeData: 'this should remain visible',
        },
      })

      const serialized = JSON.stringify(snapshot)
      expect(serialized).not.toContain(SENTINEL_API_KEY)
      expect(serialized).not.toContain(SENTINEL_DB_PASSWORD)
      expect(serialized).not.toContain('BEGIN RSA PRIVATE KEY')
      expect(serialized).not.toContain(SENTINEL_WEBHOOK_SECRET)
      expect(serialized).not.toContain(SENTINEL_REFRESH_TOKEN)
      expect(serialized).toContain('this should remain visible')
    })
  })

  describe('snapshot store never stores raw secrets in key fields', () => {
    it('recorded snapshot input with secret keys is always redacted', () => {
      const redactor = createModelInputRedactor()
      const store = createModelInputSnapshotStore(redactor)

      store.record({
        agentKind: 'foreground',
        agentType: 'main',
        agentProfile: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput({
          segments: {
            staticPrefix: 'api_key: "sk-secret123"',
            tenantProject: 'token: "tok-secret456"',
            toolPlane: '',
            contextBundle: 'password: "pwd-secret789"',
          },
        }),
      })

      const snapshots = store.getByAgent('foreground')
      expect(snapshots.length).toBeGreaterThan(0)

      const snapshot = snapshots[0]
      if (snapshot?.input) {
        const serialized = JSON.stringify(snapshot.input)
        expect(serialized).not.toContain('sk-secret123')
        expect(serialized).not.toContain('tok-secret456')
        expect(serialized).not.toContain('pwd-secret789')
      }
    })
  })
})
