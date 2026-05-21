/**
 * Production Configuration Guard
 *
 * Startup-time validator that refuses to boot when NODE_ENV=production
 * if any critical security configuration is missing or invalid.
 * In non-production environments the check is a silent no-op.
 *
 * Follows the error-collection pattern from provider-crypto.ts:
 * all errors are gathered before reporting, never fail-fast.
 */

export interface ProductionGuardResult {
  ok: boolean;
  errors: string[];
}

/** Placeholder values that indicate the user hasn't set a real secret. */
const PLACEHOLDER_SECRET_PATTERNS = [
  'your_secret_key',
  'your-secret-key',
  'changeme',
  'change_me',
  'change-me',
  'placeholder',
  'fixme',
];

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase().trim();
  for (const pattern of PLACEHOLDER_SECRET_PATTERNS) {
    if (lower.includes(pattern)) {
      return true;
    }
  }
  return false;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate production configuration.
 *
 * Accepts an explicit `env` parameter for testability.
 * When omitted, reads from `process.env`.
 */
export function checkProductionConfig(
  env: Record<string, string | undefined> = process.env
): ProductionGuardResult {
  // Non-production environments always pass — no-op guard.
  if (env.NODE_ENV !== 'production') {
    return { ok: true, errors: [] };
  }

  const errors: string[] = [];

  const secretKey = env.APP_SECRET_KEY;
  if (!secretKey) {
    errors.push('APP_SECRET_KEY is required in production but is not set');
  } else if (secretKey.length < 32) {
    errors.push(
      `APP_SECRET_KEY must be at least 32 characters (current: ${secretKey.length})`
    );
  } else if (isPlaceholder(secretKey)) {
    errors.push(
      'APP_SECRET_KEY appears to be a placeholder value; set a strong, unique secret'
    );
  }

  const hasAuthToken = !!env.API_AUTH_TOKEN;
  const hasApiKeyBootstrap = !!env.API_KEY_BOOTSTRAP;
  if (!hasAuthToken && !hasApiKeyBootstrap) {
    errors.push(
      'At least one authentication method must be enabled: set API_AUTH_TOKEN or configure API Key bootstrap'
    );
  }

  const allowedOrigins = env.ALLOWED_ORIGINS;
  if (!allowedOrigins) {
    errors.push('ALLOWED_ORIGINS is required in production but is not set');
  } else if (allowedOrigins.trim() === '*') {
    errors.push(
      'ALLOWED_ORIGINS must not be "*" in production; specify explicit comma-separated URLs'
    );
  }

  if (!env.DATABASE_URL && !env.DATABASE_PATH) {
    errors.push(
      'Either DATABASE_URL or DATABASE_PATH must be set in production'
    );
  }

  if (env.LOG_LEVEL?.toLowerCase() === 'debug') {
    errors.push(
      'LOG_LEVEL must not be "debug" in production; use "info", "warn", or "error"'
    );
  }

  if (!env.BACKUP_DIR) {
    errors.push('BACKUP_DIR is required in production but is not set');
  }

  const publicBaseUrl = env.PUBLIC_BASE_URL;
  if (!publicBaseUrl) {
    errors.push('PUBLIC_BASE_URL is required in production but is not set');
  } else if (!isValidUrl(publicBaseUrl)) {
    errors.push(
      `PUBLIC_BASE_URL must be a valid HTTP or HTTPS URL (current: "${publicBaseUrl}")`
    );
  }

  if (env.COOKIE_SECURE !== 'true') {
    const publicBaseUrl = env.PUBLIC_BASE_URL || '';
    if (publicBaseUrl.startsWith('https://')) {
      errors.push(
        'COOKIE_SECURE must be "true" in production when using HTTPS; secure cookies are required for session security'
      );
    }
    // When PUBLIC_BASE_URL is HTTP, COOKIE_SECURE=false is acceptable but not recommended.
    // This allows HTTP-only deployments to pass the guard while still flagging HTTPS deployments.
  }

  if (!env.TRUST_PROXY) {
    errors.push(
      'TRUST_PROXY must be explicitly configured in production (e.g. "1", "true", or a comma-separated list of trusted proxy IPs)'
    );
  }

  return { ok: errors.length === 0, errors };
}
