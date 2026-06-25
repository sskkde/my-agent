/**
 * Recursive secret redaction for safe logging / fixture generation.
 * Walks objects and arrays, replacing values whose keys match known
 * secret field names with `[REDACTED]`.
 */

const DEFAULT_SECRET_FIELD_NAMES: readonly string[] = [
  'token',
  'secret',
  'appSecret',
  'app_secret',
  'botToken',
  'bot_token',
  'access_token',
  'accessToken',
  'apiKey',
  'api_key',
  'webhookSecret',
  'webhook_secret',
  'verificationToken',
  'verification_token',
]

/**
 * Recursively redact secret values from an unknown structure.
 *
 * @param obj - The value to redact (object, array, or primitive).
 * @param secretFieldNames - Field names whose values should be replaced.
 *   Defaults to a comprehensive list of common secret keys.
 * @returns A deep copy with secret values replaced by `[REDACTED]`.
 *   Circular references are replaced by `"[Circular]"`.
 */
export function redactSecrets(
  obj: unknown,
  secretFieldNames: readonly string[] = DEFAULT_SECRET_FIELD_NAMES,
): unknown {
  const secretSet = new Set(secretFieldNames)
  return redactWalk(obj, secretSet, new WeakSet())
}

function redactWalk(
  value: unknown,
  secretSet: Set<string>,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value !== 'object') {
    return value
  }

  // Circular reference guard
  if (seen.has(value as object)) {
    return '[Circular]'
  }
  seen.add(value as object)

  if (Array.isArray(value)) {
    return value.map((item) => redactWalk(item, secretSet, seen))
  }

  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (secretSet.has(key)) {
      result[key] = '[REDACTED]'
    } else {
      result[key] = redactWalk(val, secretSet, seen)
    }
  }
  return result
}
