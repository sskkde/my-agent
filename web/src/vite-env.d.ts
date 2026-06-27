/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** AMap JSAPI key (Web端(JS API) type) for browser-side map rendering. */
  readonly VITE_AMAP_JSAPI_KEY?: string
  /** AMap security JS code for production domain verification. */
  readonly VITE_AMAP_SECURITY_JS_CODE?: string
  /** AMap custom service host for production reverse proxy. */
  readonly VITE_AMAP_SERVICE_HOST?: string
  /** Force AMap mock mode (no real network calls). */
  readonly VITE_AMAP_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
