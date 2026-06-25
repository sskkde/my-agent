/**
 * MCP Secret Redaction - Credential-safe URL/config/error handling for MCP connectors.
 *
 * Ensures that API keys, tokens, and other credentials embedded in MCP URLs,
 * configuration objects, and error messages never leak into metadata, logs,
 * audit events, or persisted storage.
 *
 * @module connectors/mcp/mcp-secret-redaction
 */

/**
 * Query parameter names whose values contain secrets.
 * Matched case-insensitively against URL query parameter names.
 */
const SENSITIVE_QUERY_PARAMS: ReadonlySet<string> = new Set([
  'key',
  'api_key',
  'token',
  'access_token',
  'secret',
  'apikey',
])

/**
 * Object field names whose values should be redacted.
 * Matched case-insensitively (substring match on lowercase key).
 */
const SENSITIVE_FIELD_PATTERNS: readonly string[] = [
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
  'credential',
  'authorization',
  'access_token',
  'refresh_token',
  'auth_token',
  'private_key',
  'secret_key',
  'auth_header',
  'webhook_secret',
]

const REDACTED_MARKER = '[REDACTED]'

/**
 * Redacts sensitive query parameters from a URL string.
 *
 * Parameters named `key`, `api_key`, `token`, `access_token`, `secret`, and `apikey`
 * have their values replaced with `[REDACTED]`.
 *
 * @param url - The URL string to redact.
 * @returns The URL with sensitive query parameter values replaced.
 *
 * @example
 * ```ts
 * redactMcpUrl('https://mcp.amap.com/mcp?key=REAL_SECRET')
 * // → 'https://mcp.amap.com/mcp?key=[REDACTED]'
 * ```
 */
export function redactMcpUrl(url: string): string {
  if (typeof url !== 'string' || url.length === 0) {
    return url
  }

  try {
    const parsed = new URL(url)
    let modified = false
    for (const [paramName] of parsed.searchParams) {
      if (SENSITIVE_QUERY_PARAMS.has(paramName.toLowerCase())) {
        parsed.searchParams.set(paramName, REDACTED_MARKER)
        modified = true
      }
    }
    return modified ? parsed.toString() : url
  } catch {
    // Not a valid URL — apply regex fallback for embedded key patterns
    return redactUrlInString(url)
  }
}

/**
 * Redacts credential patterns found anywhere in a string.
 * Handles URLs embedded in error messages, log lines, etc.
 */
function redactUrlInString(value: string): string {
  let result = value
  // Match query param patterns like key=VALUE, api_key=VALUE, token=VALUE
  for (const param of SENSITIVE_QUERY_PARAMS) {
    const pattern = new RegExp(`([?&]${param}=)([^&\\s]+)`, 'gi')
    result = result.replace(pattern, `$1${REDACTED_MARKER}`)
  }
  return result
}

/**
 * Redacts sensitive field values from an object recursively.
 *
 * Walks objects and arrays, replacing values whose keys match known
 * secret field patterns (case-insensitive substring match) with `[REDACTED]`.
 * Also applies content-based redaction to string values that may contain
 * embedded credentials (URLs with keys, bearer tokens, etc.).
 *
 * @param obj - The value to redact.
 * @returns A deep copy with secret values replaced. Circular refs become `[Circular]`.
 */
export function redactMcpConfig<T>(obj: T): T {
  return redactWalk(obj, new WeakSet()) as T
}

function redactWalk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'string') {
    return redactSensitiveStrings(value)
  }

  if (typeof value !== 'object') {
    return value
  }

  if (seen.has(value as object)) {
    return '[Circular]'
  }
  seen.add(value as object)

  if (Array.isArray(value)) {
    return value.map((item) => redactWalk(item, seen))
  }

  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (shouldRedactKey(key)) {
      result[key] = REDACTED_MARKER
    } else {
      result[key] = redactWalk(val, seen)
    }
  }
  return result
}

function shouldRedactKey(key: string): boolean {
  const keyLower = key.toLowerCase()
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => keyLower.includes(pattern))
}

/**
 * Content-based redaction for string values.
 * Catches embedded URLs with query params, bearer tokens, PEM keys,
 * and inline key=value patterns.
 */
function redactSensitiveStrings(value: string): string {
  let result = value

  // URLs with sensitive query params
  result = redactUrlInString(result)

  // Bearer tokens
  result = result.replace(/\b(bearer\s+)[a-zA-Z0-9_\-\.~+/]+=*/gi, `$1${REDACTED_MARKER}`)

  // api_key / apikey / token / secret in key=value or key: value patterns
  result = result.replace(
    /(?:api[_\s-]?key|token|secret|access_token)\s*[:=]\s*['"]?[a-zA-Z0-9_\-\.~+/]{8,}['"]?/gi,
    (match) => {
      const separator = match.match(/[:=]/)?.[0] ?? ':'
      const prefix = match.slice(0, match.indexOf(separator) + 1)
      return `${prefix} ${REDACTED_MARKER}`
    },
  )

  // PEM private key blocks
  result = result.replace(
    /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
    REDACTED_MARKER,
  )

  return result
}

/**
 * Sanitizes an error message that may contain MCP credentials.
 *
 * Applies content-based redaction to catch embedded URLs with API keys,
 * bearer tokens, and inline secret patterns. Also truncates excessively
 * long messages.
 *
 * @param message - The raw error message.
 * @returns A sanitized string safe for persistence and logging.
 */
export function redactMcpErrorMessage(message: string): string {
  if (typeof message !== 'string') {
    return '[SANITIZATION_ERROR]'
  }
  if (message.length === 0) {
    return ''
  }

  let sanitized = redactSensitiveStrings(message)

  // Truncate long messages
  const MAX_LENGTH = 500
  if (sanitized.length > MAX_LENGTH) {
    sanitized = sanitized.substring(0, MAX_LENGTH - 3) + '...'
  }

  return sanitized
}
