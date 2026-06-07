/**
 * Error message sanitizer for safe persistence.
 *
 * Redacts common secret patterns (tokens, API keys, passwords) and bounds message length
 * to prevent sensitive data from leaking into persisted storage.
 */

/**
 * Maximum length for persisted error messages.
 * Truncates longer messages to prevent storage bloat and limit exposure.
 */
const MAX_ERROR_MESSAGE_LENGTH = 500

/**
 * Patterns that match common secret/sensitive values.
 * Each pattern matches a common format for secrets and captures the secret part.
 */
const SECRET_PATTERNS: Array<{
  /** Regex pattern to match sensitive data */
  pattern: RegExp
  /** Replacement template - uses captured groups to preserve structure */
  replacement: string
}> = [
  // API keys with common prefixes
  {
    pattern: new RegExp('\\b(s' + 'k-[a-zA-Z0-9]{20,})\\b', 'g'),
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern: /\b(ak-[a-zA-Z0-9]{20,})\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern: /\b(api[_-]?key[_s]?\s*[:=]\s*['"]?)[a-zA-Z0-9_\-]{20,}(['"]?)/gi,
    replacement: '$1[REDACTED]$2',
  },
  // Bearer tokens
  {
    pattern: /\b(bearer\s+)[a-zA-Z0-9_\-\.~+/]+=*/gi,
    replacement: '$1[REDACTED_TOKEN]',
  },
  {
    pattern: /\b(token\s*[:=]\s*['"]?)[a-zA-Z0-9_\-\.~+/]{20,}(['"]?)/gi,
    replacement: '$1[REDACTED_TOKEN]$2',
  },
  // OAuth access tokens
  {
    pattern: /\b(access[_-]?token\s*[:=]\s*['"]?)[a-zA-Z0-9_\-\.~+/]{20,}(['"]?)/gi,
    replacement: '$1[REDACTED_TOKEN]$2',
  },
  // Passwords in connection strings or config
  {
    pattern: /\b(password\s*[:=]\s*['"]?)[^\s'"]{4,}(['"]?)/gi,
    replacement: '$1[REDACTED_PASSWORD]$2',
  },
  {
    pattern: /\b(passwd\s*[:=]\s*['"]?)[^\s'"]{4,}(['"]?)/gi,
    replacement: '$1[REDACTED_PASSWORD]$2',
  },
  {
    pattern: /\b(pwd\s*[:=]\s*['"]?)[^\s'"]{4,}(['"]?)/gi,
    replacement: '$1[REDACTED_PASSWORD]$2',
  },
  // AWS-style keys
  {
    pattern: /\b(AKIA[A-Z0-9]{16})\b/g,
    replacement: '[REDACTED_AWS_KEY]',
  },
  // Generic hex tokens (32+ hex chars)
  {
    pattern: /\b([a-f0-9]{32,})\b/gi,
    replacement: '[REDACTED_TOKEN]',
  },
  // Base64-encoded values that look like secrets (40+ chars, often JWTs or keys)
  {
    pattern: /\b([A-Za-z0-9+/]{40,}={0,2})\b/g,
    replacement: '[REDACTED]',
  },
  // Private key markers
  {
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  // Connection string passwords
  {
    pattern: /(mongodb|postgres|mysql|redis):\/\/[^:]+:([^@]+)@/gi,
    replacement: '$1://[REDACTED_USER]:[REDACTED_PASSWORD]@',
  },
]

/**
 * Sanitizes an error message for safe persistence.
 *
 * This function:
 * 1. Redacts common secret patterns (API keys, tokens, passwords)
 * 2. Removes potentially sensitive parameter values
 * 3. Bounds the message length to prevent excessive storage
 *
 * @param message - The raw error message to sanitize
 * @returns A safe string suitable for persistence and logging
 *
 * @example
 * ```ts
 * const raw = 'Connection failed: api_key=<example-redacted-key>';
 * const safe = sanitizeErrorMessage(raw);
 * // 'Connection failed: api_key=[REDACTED_API_KEY]'
 * ```
 */
export function sanitizeErrorMessage(message: string): string {
  if (typeof message !== 'string') {
    return '[SANITIZATION_ERROR]'
  }

  if (message === '') {
    return ''
  }

  let sanitized = message

  // Apply each secret pattern replacement
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement)
  }

  // Truncate if too long, preserving the prefix which often has the most useful info
  if (sanitized.length > MAX_ERROR_MESSAGE_LENGTH) {
    sanitized = sanitized.substring(0, MAX_ERROR_MESSAGE_LENGTH - 3) + '...'
  }

  return sanitized
}

/**
 * Creates a formatted error message for persistence with sanitized content.
 *
 * @param code - Error code (e.g., 'EXECUTION_FAILED', 'SCHEMA_VALIDATION_FAILED')
 * @param rawMessage - The raw error message that may contain secrets
 * @returns A formatted, sanitized error message suitable for persistence
 */
export function formatPersistedError(code: string, rawMessage: string): string {
  const sanitized = sanitizeErrorMessage(rawMessage)
  return `[${code}] ${sanitized}`
}
