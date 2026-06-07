/**
 * CORS Production Configuration
 *
 * Provides origin allowlist for production environments.
 * - Production: parses ALLOWED_ORIGINS env var (comma-separated URLs)
 * - Development: reflects any origin (origin: true)
 */

export interface CorsConfig {
  origin: boolean | string[]
  methods: string[]
  allowedHeaders: string[]
}

/**
 * Get CORS origin configuration based on environment.
 *
 * @param env - Environment variables (defaults to process.env)
 * @returns CORS configuration object for @fastify/cors
 */
export function getCorsOrigin(env: Record<string, string | undefined> = process.env): CorsConfig {
  const baseConfig = {
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }

  // Non-production: allow all origins (reflective)
  if (env.NODE_ENV !== 'production') {
    return { origin: true, ...baseConfig }
  }

  // Production: use explicit allowlist
  const allowedOrigins = env.ALLOWED_ORIGINS

  // This should be caught by production guard, but defend in depth
  if (!allowedOrigins || allowedOrigins.trim() === '*') {
    throw new Error('ALLOWED_ORIGINS must be set to explicit comma-separated URLs in production')
  }

  // Parse and trim whitespace from each origin
  const origins = allowedOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  if (origins.length === 0) {
    throw new Error('ALLOWED_ORIGINS must contain at least one valid URL in production')
  }

  return { origin: origins, ...baseConfig }
}
