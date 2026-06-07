/**
 * Model Input Redactor - Redaction pipeline for LLM call snapshots.
 * Combines patterns from replay-safety-guard.ts (key-based) and audit-recorder.ts (regex-based).
 * @module kernel/model-input/model-input-redactor
 */

export interface RedactorOptions {
  /** Additional field names to redact (dotted paths supported, e.g. 'user.apiKey') */
  extraRedactFields?: string[]
  /** Additional regex patterns for content-based redaction */
  extraSensitivePatterns?: Array<{ pattern: RegExp; replacement: string }>
}

export interface ModelInputRedactor {
  redact<T>(payload: T): T
}

/**
 * Sensitive field patterns matched against lowercased key names (substring match).
 */
const SENSITIVE_FIELD_PATTERNS = [
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
  'credential',
  'authorization',
  'private',
  'sensitive',
  'access_token',
  'refresh_token',
  'auth_token',
  'private_key',
  'secret_key',
  'auth_header',
  'webhook_secret',
  'pat', // Personal Access Token
]

/**
 * Regex patterns for content-based redaction in string values.
 * Covers JSON-like key:value patterns and PEM certificate blocks.
 */
const DEFAULT_SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Patterns with quoted values
  { pattern: /password['"]?\s*[:=]\s*['"][^'"]+['"]/gi, replacement: 'password: [REDACTED]' },
  { pattern: /secret['"]?\s*[:=]\s*['"][^'"]+['"]/gi, replacement: 'secret: [REDACTED]' },
  { pattern: /token['"]?\s*[:=]\s*['"][^'"]+['"]/gi, replacement: 'token: [REDACTED]' },
  { pattern: /api[_\s-]?key['"]?\s*[:=]\s*['"][^'"]+['"]/gi, replacement: 'api_key: [REDACTED]' },
  { pattern: /authorization['"]?\s*[:=]\s*['"][^'"]+['"]/gi, replacement: 'authorization: [REDACTED]' },
  { pattern: /private[_\s-]?key['"]?\s*[:=]\s*['"][^'"]+['"]/gi, replacement: 'private_key: [REDACTED]' },
  { pattern: /access[_\s-]?token['"]?\s*[:=]\s*['"][^'"]+['"]/gi, replacement: 'access_token: [REDACTED]' },
  { pattern: /refresh[_\s-]?token['"]?\s*[:=]\s*['"][^'"]+['"]/gi, replacement: 'refresh_token: [REDACTED]' },
  { pattern: /webhook[_\s-]?secret['"]?\s*[:=]\s*['"][^'"]+['"]/gi, replacement: 'webhook_secret: [REDACTED]' },
  // Patterns with unquoted values (plain text)
  { pattern: /password\s*[:=]\s*\S+/gi, replacement: 'password: [REDACTED]' },
  { pattern: /secret\s*[:=]\s*\S+/gi, replacement: 'secret: [REDACTED]' },
  { pattern: /token\s*[:=]\s*\S+/gi, replacement: 'token: [REDACTED]' },
  { pattern: /api[_\s-]?key\s*[:=]\s*\S+/gi, replacement: 'api_key: [REDACTED]' },
  { pattern: /authorization\s*[:=]\s*\S+/gi, replacement: 'authorization: [REDACTED]' },
  { pattern: /private[_\s-]?key\s*[:=]\s*\S+/gi, replacement: 'private_key: [REDACTED]' },
  { pattern: /access[_\s-]?token\s*[:=]\s*\S+/gi, replacement: 'access_token: [REDACTED]' },
  { pattern: /refresh[_\s-]?token\s*[:=]\s*\S+/gi, replacement: 'refresh_token: [REDACTED]' },
  { pattern: /webhook[_\s-]?secret\s*[:=]\s*\S+/gi, replacement: 'webhook_secret: [REDACTED]' },
  // PEM certificate blocks
  { pattern: /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, replacement: '[REDACTED]' },
]

/**
 * Field names for exact/dotted-path redaction (e.g. 'user.apiKey').
 */
const DEFAULT_REDACT_FIELDS = [
  'password',
  'secret',
  'apiKey',
  'api_key',
  'token',
  'accessToken',
  'access_token',
  'privateKey',
  'private_key',
  'secretKey',
  'secret_key',
  'authToken',
  'auth_token',
  'credential',
  'credentials',
  'authorization',
  'authHeader',
  'refreshToken',
  'refresh_token',
  'webhookSecret',
  'webhook_secret',
]

class ModelInputRedactorImpl implements ModelInputRedactor {
  private readonly sensitivePatterns: Array<{ pattern: RegExp; replacement: string }>
  private readonly redactFields: string[]

  constructor(options: RedactorOptions = {}) {
    this.sensitivePatterns = [...DEFAULT_SENSITIVE_PATTERNS, ...(options.extraSensitivePatterns ?? [])]
    this.redactFields = [...DEFAULT_REDACT_FIELDS, ...(options.extraRedactFields ?? [])]
  }

  redact<T>(payload: T): T {
    return this.redactValue(payload, '') as T
  }

  private shouldRedactKey(key: string): boolean {
    const keyLower = key.toLowerCase()

    for (const pattern of SENSITIVE_FIELD_PATTERNS) {
      if (keyLower.includes(pattern)) {
        return true
      }
    }

    for (const field of this.redactFields) {
      if (keyLower === field.toLowerCase() || keyLower.endsWith('.' + field.toLowerCase())) {
        return true
      }
    }

    return false
  }

  private redactValue(value: unknown, keyPath: string): unknown {
    if (value === null || value === undefined) {
      return value
    }

    if (typeof value === 'string') {
      let redactedValue = value
      for (const { pattern, replacement } of this.sensitivePatterns) {
        if (pattern.test(redactedValue)) {
          pattern.lastIndex = 0 // Reset lastIndex for global regex
          redactedValue = redactedValue.replace(pattern, replacement)
        }
      }
      return redactedValue
    }

    if (Array.isArray(value)) {
      return value.map((item, index) => this.redactValue(item, `${keyPath}[${index}]`))
    }

    if (typeof value === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(value)) {
        const fullKey = keyPath ? `${keyPath}.${key}` : key
        result[key] = this.shouldRedactKey(key) ? '[REDACTED]' : this.redactValue(val, fullKey)
      }
      return result
    }

    return value
  }
}

export function createModelInputRedactor(options?: RedactorOptions): ModelInputRedactor {
  return new ModelInputRedactorImpl(options)
}
