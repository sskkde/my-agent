import { describe, it, expect } from 'vitest';
import {
  WEB_FETCH_TIMEOUT_MS,
  WEB_FETCH_MAX_TIMEOUT_MS,
  WEB_FETCH_MAX_RESPONSE_BYTES,
  WEB_FETCH_MAX_RETURNED_CHARS,
  ALLOWED_PROTOCOLS,
  validateUrlSafety,
  isIpAddress,
  parseIpv4,
  isPrivateIpv4,
  isPrivateIpv6,
  validateIpSafety,
  validateTimeout,
  validateRedirectSafety,
  truncateResponse,
  exceedsSizeLimit,
} from '../../../src/tools/builtins/web-safety.js';

describe('web-safety', () => {
  describe('Constants', () => {
    it('should have correct timeout values', () => {
      expect(WEB_FETCH_TIMEOUT_MS).toBe(10000);
      expect(WEB_FETCH_MAX_TIMEOUT_MS).toBe(30000);
    });

    it('should have correct size limits', () => {
      expect(WEB_FETCH_MAX_RESPONSE_BYTES).toBe(1024 * 1024);
      expect(WEB_FETCH_MAX_RETURNED_CHARS).toBe(50000);
    });

    it('should only allow http and https protocols', () => {
      expect(ALLOWED_PROTOCOLS).toEqual(['http:', 'https:']);
    });
  });

  describe('validateUrlSafety', () => {
    describe('Valid URLs', () => {
      it('should accept valid http URLs', () => {
        const result = validateUrlSafety('http://example.com/path');
        expect(result.safe).toBe(true);
        expect(result.protocol).toBe('http:');
        expect(result.hostname).toBe('example.com');
      });

      it('should accept valid https URLs', () => {
        const result = validateUrlSafety('https://example.com/path');
        expect(result.safe).toBe(true);
        expect(result.protocol).toBe('https:');
      });

      it('should normalize URLs', () => {
        const result = validateUrlSafety('https://example.com/path?query=1');
        expect(result.safe).toBe(true);
        expect(result.normalizedUrl).toBeDefined();
      });
    });

    describe('Invalid URLs', () => {
      it('should reject invalid URL format', () => {
        const result = validateUrlSafety('not a valid url');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('INVALID_URL');
      });

      it('should reject file:// protocol', () => {
        const result = validateUrlSafety('file:///etc/passwd');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('BLOCKED_PROTOCOL');
      });

      it('should reject data: protocol', () => {
        const result = validateUrlSafety('data:text/html,<h1>test</h1>');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('BLOCKED_PROTOCOL');
      });

      it('should reject javascript: protocol', () => {
        const result = validateUrlSafety('javascript:alert(1)');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('BLOCKED_PROTOCOL');
      });

      it('should reject ftp:// protocol', () => {
        const result = validateUrlSafety('ftp://example.com/file');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('BLOCKED_PROTOCOL');
      });
    });

    describe('Localhost blocking', () => {
      it('should reject localhost', () => {
        const result = validateUrlSafety('http://localhost:3000');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('LOCALHOST_BLOCKED');
      });

      it('should reject localtest.me', () => {
        const result = validateUrlSafety('http://localtest.me');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('LOCALHOST_BLOCKED');
      });
    });

    describe('Private IP blocking', () => {
      it('should reject 127.0.0.1 (loopback)', () => {
        const result = validateUrlSafety('http://127.0.0.1/');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('PRIVATE_IP');
      });

      it('should reject 127.0.0.5 (loopback range)', () => {
        const result = validateUrlSafety('http://127.0.0.5/');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('PRIVATE_IP');
      });

      it('should reject 10.0.0.1 (RFC1918)', () => {
        const result = validateUrlSafety('http://10.0.0.1/');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('PRIVATE_IP');
      });

      it('should reject 172.16.0.1 (RFC1918)', () => {
        const result = validateUrlSafety('http://172.16.0.1/');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('PRIVATE_IP');
      });

      it('should reject 192.168.1.1 (RFC1918)', () => {
        const result = validateUrlSafety('http://192.168.1.1/');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('PRIVATE_IP');
      });

      it('should reject 169.254.169.254 (metadata endpoint)', () => {
        const result = validateUrlSafety('http://169.254.169.254/');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('PRIVATE_IP');
      });

      it('should reject link-local 169.254.1.1', () => {
        const result = validateUrlSafety('http://169.254.1.1/');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('PRIVATE_IP');
      });

      it('should accept public IPs', () => {
        const result = validateUrlSafety('http://8.8.8.8/');
        expect(result.safe).toBe(true);
      });
    });

    describe('IPv6 blocking', () => {
      it('should reject ::1 (IPv6 loopback)', () => {
        const result = validateUrlSafety('http://[::1]/');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('PRIVATE_IP');
      });

      it('should reject fe80::1 (IPv6 link-local)', () => {
        const result = validateUrlSafety('http://[fe80::1]/');
        expect(result.safe).toBe(false);
        expect(result.error?.code).toBe('PRIVATE_IP');
      });
    });
  });

  describe('IP Address Detection', () => {
    describe('isIpAddress', () => {
      it('should detect IPv4 addresses', () => {
        expect(isIpAddress('192.168.1.1')).toBe(true);
        expect(isIpAddress('8.8.8.8')).toBe(true);
        expect(isIpAddress('127.0.0.1')).toBe(true);
      });

      it('should detect IPv6 addresses', () => {
        expect(isIpAddress('::1')).toBe(true);
        expect(isIpAddress('fe80::1')).toBe(true);
        expect(isIpAddress('2001:db8::1')).toBe(true);
      });

      it('should return false for hostnames', () => {
        expect(isIpAddress('example.com')).toBe(false);
        expect(isIpAddress('localhost')).toBe(false);
      });
    });

    describe('parseIpv4', () => {
      it('should parse valid IPv4 addresses', () => {
        expect(parseIpv4('0.0.0.0')).toBe(0n);
        expect(parseIpv4('192.168.1.1')).toBe(3232235777n);
        expect(parseIpv4('255.255.255.255')).toBe(4294967295n);
      });

      it('should return null for invalid addresses', () => {
        expect(parseIpv4('256.0.0.1')).toBeNull();
        expect(parseIpv4('1.2.3')).toBeNull();
        expect(parseIpv4('not.an.ip')).toBeNull();
      });
    });

    describe('isPrivateIpv4', () => {
      it('should detect loopback range', () => {
        expect(isPrivateIpv4('127.0.0.1')).toBe(true);
        expect(isPrivateIpv4('127.255.255.255')).toBe(true);
      });

      it('should detect 10.0.0.0/8 range', () => {
        expect(isPrivateIpv4('10.0.0.1')).toBe(true);
        expect(isPrivateIpv4('10.255.255.255')).toBe(true);
      });

      it('should detect 172.16.0.0/12 range', () => {
        expect(isPrivateIpv4('172.16.0.1')).toBe(true);
        expect(isPrivateIpv4('172.31.255.255')).toBe(true);
      });

      it('should detect 192.168.0.0/16 range', () => {
        expect(isPrivateIpv4('192.168.0.1')).toBe(true);
        expect(isPrivateIpv4('192.168.255.255')).toBe(true);
      });

      it('should detect metadata endpoint', () => {
        expect(isPrivateIpv4('169.254.169.254')).toBe(true);
      });

      it('should detect link-local range', () => {
        expect(isPrivateIpv4('169.254.1.1')).toBe(true);
      });

      it('should return false for public IPs', () => {
        expect(isPrivateIpv4('8.8.8.8')).toBe(false);
        expect(isPrivateIpv4('1.1.1.1')).toBe(false);
      });
    });

    describe('isPrivateIpv6', () => {
      it('should detect IPv6 loopback', () => {
        expect(isPrivateIpv6('::1')).toBe(true);
        expect(isPrivateIpv6('0:0:0:0:0:0:0:1')).toBe(true);
      });

      it('should detect IPv6 link-local', () => {
        expect(isPrivateIpv6('fe80::1')).toBe(true);
        expect(isPrivateIpv6('fe80::1234:5678:abcd:ef01')).toBe(true);
      });

      it('should detect IPv6 unspecified address', () => {
        expect(isPrivateIpv6('::')).toBe(true);
      });

      it('should return false for public IPv6', () => {
        expect(isPrivateIpv6('2001:db8::1')).toBe(false);
      });
    });

    describe('validateIpSafety', () => {
      it('should validate IPv4 addresses', () => {
        const privateResult = validateIpSafety('192.168.1.1');
        expect(privateResult.safe).toBe(false);
        
        const publicResult = validateIpSafety('8.8.8.8');
        expect(publicResult.safe).toBe(true);
      });

      it('should validate IPv6 addresses', () => {
        const loopbackResult = validateIpSafety('::1');
        expect(loopbackResult.safe).toBe(false);
      });
    });
  });

  describe('Timeout Validation', () => {
    it('should return default timeout when undefined', () => {
      expect(validateTimeout(undefined)).toBe(WEB_FETCH_TIMEOUT_MS);
    });

    it('should return default timeout for negative values', () => {
      expect(validateTimeout(-1)).toBe(WEB_FETCH_TIMEOUT_MS);
    });

    it('should clamp to max timeout', () => {
      expect(validateTimeout(60000)).toBe(WEB_FETCH_MAX_TIMEOUT_MS);
    });

    it('should accept valid timeouts', () => {
      expect(validateTimeout(5000)).toBe(5000);
      expect(validateTimeout(15000)).toBe(15000);
    });
  });

  describe('Redirect Safety', () => {
    it('should validate redirect URLs', () => {
      const result = validateRedirectSafety(
        'https://example.com/',
        'https://redirect.com/'
      );
      
      expect(result.safe).toBe(true);
      expect(result.hostname).toBe('redirect.com');
    });

    it('should reject redirects to blocked IPs', () => {
      const result = validateRedirectSafety(
        'https://example.com/',
        'http://127.0.0.1/'
      );
      
      expect(result.safe).toBe(false);
      expect(result.error?.code).toBe('PRIVATE_IP');
    });

    it('should reject redirects to localhost', () => {
      const result = validateRedirectSafety(
        'https://example.com/',
        'http://localhost/'
      );
      
      expect(result.safe).toBe(false);
      expect(result.error?.code).toBe('LOCALHOST_BLOCKED');
    });

    it('should reject redirects to blocked protocols', () => {
      const result = validateRedirectSafety(
        'https://example.com/',
        'file:///etc/passwd'
      );
      
      expect(result.safe).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_PROTOCOL');
    });
  });

  describe('Response Size Helpers', () => {
    describe('truncateResponse', () => {
      it('should not truncate short content', () => {
        const content = 'Hello, World!';
        const result = truncateResponse(content);
        expect(result).toBe(content);
      });

      it('should truncate long content', () => {
        const content = 'x'.repeat(60000);
        const result = truncateResponse(content);
        expect(result.length).toBeLessThanOrEqual(WEB_FETCH_MAX_RETURNED_CHARS + 20);
        expect(result.endsWith('[...truncated...]')).toBe(true);
      });

      it('should use custom max chars', () => {
        const content = 'x'.repeat(100);
        const result = truncateResponse(content, 50);
        expect(result.length).toBeLessThanOrEqual(70);
        expect(result.endsWith('[...truncated...]')).toBe(true);
      });
    });

    describe('exceedsSizeLimit', () => {
      it('should return false for small sizes', () => {
        expect(exceedsSizeLimit(100)).toBe(false);
        expect(exceedsSizeLimit(1024)).toBe(false);
      });

      it('should return true for large sizes', () => {
        expect(exceedsSizeLimit(2 * 1024 * 1024)).toBe(true);
      });

      it('should use custom max bytes', () => {
        expect(exceedsSizeLimit(100, 50)).toBe(true);
        expect(exceedsSizeLimit(100, 200)).toBe(false);
      });
    });
  });
});