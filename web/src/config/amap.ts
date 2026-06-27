/**
 * AMap JSAPI frontend configuration.
 *
 * Reads Vite-prefixed environment variables for the AMap JS API loader.
 * These are SEPARATE from the backend `AMAP_MAPS_API_KEY` used by the
 * AMap MCP connector — the JSAPI key is a browser-side key obtained from
 * the AMap console under "Web端(JS API)" type.
 *
 * Security: AMap JSAPI requires `window._AMapSecurityConfig` to be set
 * BEFORE calling `AMapLoader.load()`. The security JS code is only needed
 * in production deployments with a registered domain.
 *
 * @module web/src/config/amap
 */

/** Resolved AMap frontend configuration. */
export interface AmapConfig {
  /** AMap JSAPI key (Web端(JS API) type). */
  readonly key: string
  /** AMap JSAPI version to load (e.g. "2.0"). */
  readonly version: string
  /**
   * Optional security JS code for production.
   * When set, `window._AMapSecurityConfig.securityJsCode` is configured
   * before loading the JSAPI.
   */
  readonly securityJsCode?: string
  /**
   * Optional service host override for production with custom domain.
   * Passed as `serviceHost` option to `AMapLoader.load()`.
   */
  readonly serviceHost?: string
}

/**
 * Return the AMap JSAPI configuration if the key is set.
 * Returns `null` when `VITE_AMAP_JSAPI_KEY` is not configured,
 * indicating the map feature is disabled.
 */
export function getAmapConfig(): AmapConfig | null {
  const key = import.meta.env.VITE_AMAP_JSAPI_KEY
  if (!key) return null

  return {
    key,
    version: '2.0',
    securityJsCode: import.meta.env.VITE_AMAP_SECURITY_JS_CODE || undefined,
    serviceHost: import.meta.env.VITE_AMAP_SERVICE_HOST || undefined,
  }
}

/**
 * Whether AMap JSAPI is configured and can be loaded.
 * Returns `false` when the JSAPI key is not set.
 */
export function isAmapEnabled(): boolean {
  return !!import.meta.env.VITE_AMAP_JSAPI_KEY
}

/**
 * Whether to run in AMap mock mode.
 *
 * Mock mode activates when:
 * - `VITE_AMAP_JSAPI_KEY` is not set (map is disabled anyway), OR
 * - `VITE_AMAP_MOCK` is explicitly set to `"true"` (useful in tests
 *   where a key exists but no real AMap network calls should happen).
 *
 * In mock mode, map components should render a placeholder instead of
 * attempting to load the real JSAPI.
 */
export function isAmapMockMode(): boolean {
  if (!import.meta.env.VITE_AMAP_JSAPI_KEY) return true
  return import.meta.env.VITE_AMAP_MOCK === 'true'
}
