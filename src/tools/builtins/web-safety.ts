/**
 * Web Safety Helpers for URL Fetch Boundaries
 *
 * Enforces URL validation, protocol filtering, private IP blocking,
 * and redirect host revalidation for safe web fetch operations.
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Default timeout for web fetch operations (10 seconds)
 */
export const WEB_FETCH_TIMEOUT_MS = 10000

/**
 * Maximum allowed timeout for web fetch operations (30 seconds)
 */
export const WEB_FETCH_MAX_TIMEOUT_MS = 30000

/**
 * Maximum response bytes to download (1 MiB)
 */
export const WEB_FETCH_MAX_RESPONSE_BYTES = 1024 * 1024

/**
 * Maximum characters to return in response (50 KB)
 */
export const WEB_FETCH_MAX_RETURNED_CHARS = 50000

/**
 * Allowed protocols for web fetch
 */
export const ALLOWED_PROTOCOLS = ['http:', 'https:']

// ============================================================================
// Private IP Ranges
// ============================================================================

/**
 * Private IP ranges that should be blocked
 *
 * Includes:
 * - RFC1918 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - Loopback (127.0.0.0/8)
 * - Link-local (169.254.0.0/16)
 * - Metadata endpoint (169.254.169.254)
 * - IPv6 loopback (::1)
 * - IPv6 link-local (fe80::/10)
 */
export interface IpRange {
  start: bigint
  end: bigint
  description: string
}

/**
 * Convert IPv4 octets to bigint
 */
function ipv4ToBigInt(a: number, b: number, c: number, d: number): bigint {
  return (BigInt(a) << 24n) + (BigInt(b) << 16n) + (BigInt(c) << 8n) + BigInt(d)
}

/**
 * Private IP ranges (IPv4)
 */
const PRIVATE_IP_RANGES: IpRange[] = [
  // Loopback: 127.0.0.0/8
  {
    start: ipv4ToBigInt(127, 0, 0, 0),
    end: ipv4ToBigInt(127, 255, 255, 255),
    description: 'Loopback (127.0.0.0/8)',
  },
  // RFC1918: 10.0.0.0/8
  {
    start: ipv4ToBigInt(10, 0, 0, 0),
    end: ipv4ToBigInt(10, 255, 255, 255),
    description: 'Private (10.0.0.0/8)',
  },
  // RFC1918: 172.16.0.0/12
  {
    start: ipv4ToBigInt(172, 16, 0, 0),
    end: ipv4ToBigInt(172, 31, 255, 255),
    description: 'Private (172.16.0.0/12)',
  },
  // RFC1918: 192.168.0.0/16
  {
    start: ipv4ToBigInt(192, 168, 0, 0),
    end: ipv4ToBigInt(192, 168, 255, 255),
    description: 'Private (192.168.0.0/16)',
  },
  // Link-local: 169.254.0.0/16
  {
    start: ipv4ToBigInt(169, 254, 0, 0),
    end: ipv4ToBigInt(169, 254, 255, 255),
    description: 'Link-local (169.254.0.0/16)',
  },
]

/**
 * Metadata endpoint: 169.254.169.254 (AWS/GCP/Azure metadata)
 */
const METADATA_IP = ipv4ToBigInt(169, 254, 169, 254)

// ============================================================================
// URL Safety Checks
// ============================================================================

/**
 * Result of URL safety validation
 */
export interface UrlSafetyResult {
  safe: boolean
  error?: {
    code: string
    message: string
  }
  normalizedUrl?: string
  hostname?: string
  protocol?: string
}

/**
 * Validate a URL for safe fetching
 *
 * Checks:
 * 1. Valid URL format
 * 2. Allowed protocol (http/https only)
 * 3. Not a private/blocked IP
 * 4. Not localhost
 */
export function validateUrlSafety(url: string): UrlSafetyResult {
  let parsedUrl: URL

  // Parse URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return {
      safe: false,
      error: {
        code: 'INVALID_URL',
        message: 'Invalid URL format',
      },
    }
  }

  // Check protocol
  if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
    return {
      safe: false,
      error: {
        code: 'BLOCKED_PROTOCOL',
        message: `Protocol '${parsedUrl.protocol}' is not allowed. Only http and https are permitted.`,
      },
    }
  }

  const hostname = parsedUrl.hostname

  // Check for localhost
  if (hostname === 'localhost' || hostname === 'localtest.me') {
    return {
      safe: false,
      error: {
        code: 'LOCALHOST_BLOCKED',
        message: 'Access to localhost is blocked',
      },
    }
  }

  // Extract IP from hostname (IPv6 URLs have brackets: [::1])
  const ipToCheck = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname

  // Check if hostname is an IP address
  if (isIpAddress(ipToCheck)) {
    const ipCheck = validateIpSafety(ipToCheck)
    if (!ipCheck.safe) {
      return ipCheck
    }
  }

  return {
    safe: true,
    normalizedUrl: parsedUrl.href,
    hostname: parsedUrl.hostname,
    protocol: parsedUrl.protocol,
  }
}

// ============================================================================
// IP Address Validation
// ============================================================================

/**
 * Check if a string is an IP address (IPv4 or IPv6)
 */
export function isIpAddress(str: string): boolean {
  // IPv4 pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/
  if (ipv4Pattern.test(str)) {
    return true
  }

  // IPv6 patterns (simplified)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/
  const ipv6PatternWithDoubleColon = /^([0-9a-fA-F]{0,4}:)*:([0-9a-fA-F]{0,4}:)*[0-9a-fA-F]{0,4}$/

  return ipv6Pattern.test(str) || ipv6PatternWithDoubleColon.test(str)
}

/**
 * Parse IPv4 address to bigint
 */
export function parseIpv4(ip: string): bigint | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null

  const octets = parts.map((p) => parseInt(p, 10))

  // Validate octet ranges
  for (const octet of octets) {
    if (isNaN(octet) || octet < 0 || octet > 255) {
      return null
    }
  }

  return ipv4ToBigInt(octets[0]!, octets[1]!, octets[2]!, octets[3]!)
}

/**
 * Check if IPv4 address is in a private range
 */
export function isPrivateIpv4(ip: string): boolean {
  const ipNum = parseIpv4(ip)
  if (ipNum === null) return false

  // Check metadata endpoint
  if (ipNum === METADATA_IP) {
    return true
  }

  // Check private ranges
  for (const range of PRIVATE_IP_RANGES) {
    if (ipNum >= range.start && ipNum <= range.end) {
      return true
    }
  }

  return false
}

/**
 * Check if IPv6 address is private/loopback
 */
export function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase()

  // IPv6 loopback: ::1
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
    return true
  }

  // IPv6 link-local: fe80::/10
  if (
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true
  }

  // IPv6 localhost variations
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') {
    return true
  }

  return false
}

/**
 * Validate IP address safety
 */
export function validateIpSafety(ip: string): UrlSafetyResult {
  // Check IPv4
  if (ip.includes('.')) {
    if (isPrivateIpv4(ip)) {
      return {
        safe: false,
        error: {
          code: 'PRIVATE_IP',
          message: `IP address '${ip}' is in a private/blocked range`,
        },
      }
    }
    return { safe: true }
  }

  // Check IPv6
  if (ip.includes(':')) {
    if (isPrivateIpv6(ip)) {
      return {
        safe: false,
        error: {
          code: 'PRIVATE_IP',
          message: `IP address '${ip}' is in a private/blocked range`,
        },
      }
    }
    return { safe: true }
  }

  return { safe: true }
}

// ============================================================================
// Timeout Validation
// ============================================================================

/**
 * Validate and clamp timeout value
 */
export function validateTimeout(timeout?: number): number {
  if (timeout === undefined) {
    return WEB_FETCH_TIMEOUT_MS
  }

  if (timeout < 0) {
    return WEB_FETCH_TIMEOUT_MS
  }

  if (timeout > WEB_FETCH_MAX_TIMEOUT_MS) {
    return WEB_FETCH_MAX_TIMEOUT_MS
  }

  return timeout
}

// ============================================================================
// Redirect Safety
// ============================================================================

/**
 * Validate redirect target URL
 *
 * Must re-validate the new host to prevent redirect-based SSRF
 */
export function validateRedirectSafety(originalUrl: string, redirectUrl: string): UrlSafetyResult {
  // Validate the redirect URL itself
  const redirectCheck = validateUrlSafety(redirectUrl)
  if (!redirectCheck.safe) {
    return redirectCheck
  }

  // Optionally: Check if redirect host differs from original
  // This is informational, not a security check
  try {
    const originalParsed = new URL(originalUrl)
    const redirectParsed = new URL(redirectUrl)

    if (originalParsed.hostname !== redirectParsed.hostname) {
      // Host changed - this is allowed but worth noting
      return {
        safe: true,
        normalizedUrl: redirectParsed.href,
        hostname: redirectParsed.hostname,
        protocol: redirectParsed.protocol,
      }
    }
  } catch {
    // If we can't parse original, just return redirect validation
    return redirectCheck
  }

  return redirectCheck
}

// ============================================================================
// Response Size Helpers
// ============================================================================

/**
 * Truncate response content to max characters
 */
export function truncateResponse(content: string, maxChars?: number): string {
  const limit = maxChars ?? WEB_FETCH_MAX_RETURNED_CHARS

  if (content.length <= limit) {
    return content
  }

  return content.slice(0, limit) + '\n\n[...truncated...]'
}

/**
 * Check if response exceeds size limit
 */
export function exceedsSizeLimit(bytes: number, maxBytes?: number): boolean {
  const limit = maxBytes ?? WEB_FETCH_MAX_RESPONSE_BYTES
  return bytes > limit
}
