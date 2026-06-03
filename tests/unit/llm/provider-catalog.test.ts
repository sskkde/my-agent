import { describe, it, expect } from 'vitest';
import {
  BUILTIN_PROVIDER_CATALOG,
  getProviderCatalogEntry,
  isKnownProviderType,
  listProviderCatalogEntries,
} from '../../../src/llm/catalog/provider-catalog.js';

describe('ProviderCatalog', () => {
  describe('BUILTIN_PROVIDER_CATALOG', () => {
    it('should have correct entry for openai', () => {
      const entry = BUILTIN_PROVIDER_CATALOG.find(e => e.providerType === 'openai');
      expect(entry).toBeDefined();
      expect(entry?.family).toBe('openai');
      expect(entry?.protocol).toBe('openai_chat');
      expect(entry?.requiresApiKey).toBe(true);
      expect(entry?.requiresBaseUrl).toBe(false);
      expect(entry?.defaultBaseUrl).toBeUndefined();
    });

    it('should have correct entry for openrouter', () => {
      const entry = BUILTIN_PROVIDER_CATALOG.find(e => e.providerType === 'openrouter');
      expect(entry).toBeDefined();
      expect(entry?.family).toBe('openai_compatible');
      expect(entry?.protocol).toBe('openai_chat');
      expect(entry?.requiresApiKey).toBe(true);
      expect(entry?.requiresBaseUrl).toBe(false);
    });

    it('should have correct entry for deepseek', () => {
      const entry = BUILTIN_PROVIDER_CATALOG.find(e => e.providerType === 'deepseek');
      expect(entry).toBeDefined();
      expect(entry?.family).toBe('deepseek');
      expect(entry?.protocol).toBe('openai_chat');
      expect(entry?.requiresApiKey).toBe(true);
      expect(entry?.requiresBaseUrl).toBe(false);
      expect(entry?.defaultBaseUrl).toBe('https://api.deepseek.com');
      expect(entry?.defaultModel).toBe('deepseek-chat');
    });

    it('should have correct entry for ollama', () => {
      const entry = BUILTIN_PROVIDER_CATALOG.find(e => e.providerType === 'ollama');
      expect(entry).toBeDefined();
      expect(entry?.family).toBe('ollama');
      expect(entry?.protocol).toBe('ollama_chat');
      expect(entry?.requiresApiKey).toBe(false);
      expect(entry?.requiresBaseUrl).toBe(true);
      expect(entry?.defaultBaseUrl).toBe('http://localhost:11434');
    });

    it('should have correct entry for custom', () => {
      const entry = BUILTIN_PROVIDER_CATALOG.find(e => e.providerType === 'custom');
      expect(entry).toBeDefined();
      expect(entry?.family).toBe('openai_compatible');
      expect(entry?.protocol).toBe('openai_chat');
      expect(entry?.requiresApiKey).toBe(true);
      expect(entry?.requiresBaseUrl).toBe(true);
    });
  });

  describe('getProviderCatalogEntry', () => {
    it('should return entry for known provider types', () => {
      const openaiEntry = getProviderCatalogEntry('openai');
      expect(openaiEntry).not.toBeNull();
      expect(openaiEntry?.providerType).toBe('openai');

      const ollamaEntry = getProviderCatalogEntry('ollama');
      expect(ollamaEntry).not.toBeNull();
      expect(ollamaEntry?.providerType).toBe('ollama');
    });

    it('should return null for unknown provider types', () => {
      const entry = getProviderCatalogEntry('unknown-provider');
      expect(entry).toBeNull();
    });

    it('should return null for empty string', () => {
      const entry = getProviderCatalogEntry('');
      expect(entry).toBeNull();
    });
  });

  describe('isKnownProviderType', () => {
    it('should return true for known provider types', () => {
      expect(isKnownProviderType('openai')).toBe(true);
      expect(isKnownProviderType('openrouter')).toBe(true);
      expect(isKnownProviderType('deepseek')).toBe(true);
      expect(isKnownProviderType('ollama')).toBe(true);
      expect(isKnownProviderType('custom')).toBe(true);
    });

    it('should return false for unknown provider types', () => {
      expect(isKnownProviderType('unknown')).toBe(false);
      expect(isKnownProviderType('anthropic')).toBe(false);
      expect(isKnownProviderType('')).toBe(false);
    });
  });

  describe('listProviderCatalogEntries', () => {
    it('should return at least 5 entries', () => {
      const entries = listProviderCatalogEntries();
      expect(entries.length).toBeGreaterThanOrEqual(5);
    });

    it('should return a copy of the catalog', () => {
      const entries1 = listProviderCatalogEntries();
      const entries2 = listProviderCatalogEntries();
      expect(entries1).not.toBe(entries2);
      expect(entries1).toEqual(entries2);
    });

    it('should include all expected provider types', () => {
      const entries = listProviderCatalogEntries();
      const providerTypes = entries.map(e => e.providerType);
      expect(providerTypes).toContain('openai');
      expect(providerTypes).toContain('openrouter');
      expect(providerTypes).toContain('deepseek');
      expect(providerTypes).toContain('ollama');
      expect(providerTypes).toContain('custom');
    });
  });
});
