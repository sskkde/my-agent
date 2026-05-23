import { describe, it, expect } from 'vitest';
import {
  normalizeContent,
  computeTemplateHash,
  computeStableHash,
  computeShortHash,
  computeShortStableHash,
} from '../../../src/prompt/template-hash.js';

describe('template-hash', () => {
  describe('normalizeContent', () => {
    it('trims leading and trailing whitespace', () => {
      expect(normalizeContent('  hello  ')).toBe('hello');
    });

    it('normalizes CRLF to LF', () => {
      expect(normalizeContent('line1\r\nline2')).toBe('line1\nline2');
    });

    it('normalizes CR to LF', () => {
      expect(normalizeContent('line1\rline2')).toBe('line1\nline2');
    });

    it('removes trailing spaces from each line', () => {
      expect(normalizeContent('line1  \nline2  ')).toBe('line1\nline2');
    });

    it('preserves internal whitespace', () => {
      expect(normalizeContent('hello   world')).toBe('hello   world');
    });
  });

  describe('computeTemplateHash', () => {
    it('returns same hash for identical content', () => {
      const hash1 = computeTemplateHash('Hello World');
      const hash2 = computeTemplateHash('Hello World');
      expect(hash1).toBe(hash2);
    });

    it('returns same hash for whitespace differences', () => {
      const hash1 = computeTemplateHash('Hello World');
      const hash2 = computeTemplateHash('  Hello World  ');
      expect(hash1).toBe(hash2);
    });

    it('returns same hash for line ending differences', () => {
      const hash1 = computeTemplateHash('line1\nline2');
      const hash2 = computeTemplateHash('line1\r\nline2');
      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different content', () => {
      const hash1 = computeTemplateHash('Hello');
      const hash2 = computeTemplateHash('World');
      expect(hash1).not.toBe(hash2);
    });

    it('returns 64-character hex string', () => {
      const hash = computeTemplateHash('test');
      expect(hash).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
    });
  });

  describe('computeStableHash', () => {
    it('returns same hash for same segments in same order', () => {
      const segments = ['segment1', 'segment2', 'segment3'];
      const hash1 = computeStableHash(segments);
      const hash2 = computeStableHash(segments);
      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different segments', () => {
      const hash1 = computeStableHash(['a', 'b']);
      const hash2 = computeStableHash(['a', 'c']);
      expect(hash1).not.toBe(hash2);
    });

    it('returns different hash for different order', () => {
      const hash1 = computeStableHash(['a', 'b']);
      const hash2 = computeStableHash(['b', 'a']);
      expect(hash1).not.toBe(hash2);
    });

    it('handles empty array', () => {
      const hash = computeStableHash([]);
      expect(hash).toHaveLength(64);
    });

    it('produces deterministic output', () => {
      const segments = ['platform', 'provider', 'agent', 'schema'];
      const hash1 = computeStableHash(segments);
      const hash2 = computeStableHash(segments);
      expect(hash1).toBe(hash2);
    });
  });

  describe('computeShortHash', () => {
    it('returns first 16 characters of full hash', () => {
      const fullHash = computeTemplateHash('test');
      const shortHash = computeShortHash('test');
      expect(shortHash).toBe(fullHash.slice(0, 16));
    });

    it('returns 16-character string', () => {
      const hash = computeShortHash('test');
      expect(hash).toHaveLength(16);
    });
  });

  describe('computeShortStableHash', () => {
    it('returns first 16 characters of stable hash', () => {
      const segments = ['a', 'b', 'c'];
      const fullHash = computeStableHash(segments);
      const shortHash = computeShortStableHash(segments);
      expect(shortHash).toBe(fullHash.slice(0, 16));
    });
  });
});
