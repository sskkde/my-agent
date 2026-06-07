export interface UrlValidationResult {
  valid: boolean
  error?: string
  blockedReason?: 'private_ip' | 'invalid_url'
}

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^0\.0\.0\.0$/,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^localhost$/i,
]

export function isPrivateIp(urlString: string): boolean {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(urlString)
  } catch {
    return false
  }

  const hostname = parsedUrl.hostname.toLowerCase()

  if (PRIVATE_IP_RANGES.some((pattern) => pattern.test(hostname))) {
    return true
  }

  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  const match = hostname.match(ipv4Regex)

  if (match) {
    const octets = [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10), parseInt(match[4], 10)]

    if (octets[0] === 127) return true
    if (octets[0] === 10) return true
    if (octets[0] === 0 && octets[1] === 0 && octets[2] === 0 && octets[3] === 0) return true
    if (octets[0] === 192 && octets[1] === 168) return true
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true
    if (octets[0] === 169 && octets[1] === 254) return true
  }

  return false
}

export function validateUrl(urlString: string): UrlValidationResult {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(urlString)
  } catch {
    return {
      valid: false,
      error: 'Invalid URL format',
      blockedReason: 'invalid_url',
    }
  }

  const protocol = parsedUrl.protocol.toLowerCase()
  if (protocol !== 'http:' && protocol !== 'https:') {
    return {
      valid: false,
      error: `Unsupported protocol: ${protocol}. Only http and https are allowed.`,
      blockedReason: 'invalid_url',
    }
  }

  if (isPrivateIp(urlString)) {
    return {
      valid: false,
      error: 'Private/internal IP addresses are not allowed for security reasons',
      blockedReason: 'private_ip',
    }
  }

  return { valid: true }
}
