import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadPreferences,
  savePreferences,
  updatePreference,
  resetPreferences,
  getDefaultPreferences,
  getPreferencesStorageKey,
  type CommandPreferences,
  type ThinkingLevel,
} from '../preferences.js';

describe('Command Preferences', () => {
  const storageKey = 'agent-platform.console.commandPrefs';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDefaultPreferences', () => {
    it('should return default preferences', () => {
      const defaults = getDefaultPreferences();
      
      expect(defaults).toEqual({
        verbose: false,
        reasoningVisible: false,
        thinkingLevel: 'off',
      });
    });

    it('should return a copy of defaults (not reference)', () => {
      const defaults1 = getDefaultPreferences();
      const defaults2 = getDefaultPreferences();
      
      defaults1.verbose = true;
      
      expect(defaults2.verbose).toBe(false);
    });
  });

  describe('getPreferencesStorageKey', () => {
    it('should return the correct storage key', () => {
      expect(getPreferencesStorageKey()).toBe(storageKey);
    });
  });

  describe('loadPreferences', () => {
    it('should return defaults when no preferences stored', () => {
      const prefs = loadPreferences();
      
      expect(prefs).toEqual(getDefaultPreferences());
    });

    it('should load stored preferences', () => {
      const stored: CommandPreferences = {
        verbose: true,
        reasoningVisible: true,
        thinkingLevel: 'medium',
      };
      localStorage.setItem(storageKey, JSON.stringify(stored));

      const prefs = loadPreferences();
      
      expect(prefs).toEqual(stored);
    });

    it('should handle corrupted JSON gracefully', () => {
      localStorage.setItem(storageKey, 'not valid json');

      const prefs = loadPreferences();
      
      expect(prefs).toEqual(getDefaultPreferences());
    });

    it('should handle partial corruption by using defaults for invalid fields', () => {
      localStorage.setItem(storageKey, JSON.stringify({
        verbose: 'not a boolean',
        reasoningVisible: true,
        thinkingLevel: 'invalid',
      }));

      const prefs = loadPreferences();
      
      expect(prefs.verbose).toBe(false); // default
      expect(prefs.reasoningVisible).toBe(true); // preserved
      expect(prefs.thinkingLevel).toBe('off'); // default
    });

    it('should handle missing fields by using defaults', () => {
      localStorage.setItem(storageKey, JSON.stringify({
        verbose: true,
      }));

      const prefs = loadPreferences();
      
      expect(prefs.verbose).toBe(true);
      expect(prefs.reasoningVisible).toBe(false);
      expect(prefs.thinkingLevel).toBe('off');
    });

    it('should handle localStorage being unavailable', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });

      const prefs = loadPreferences();
      
      expect(prefs).toEqual(getDefaultPreferences());
    });

    it('should handle null stored value', () => {
      localStorage.setItem(storageKey, 'null');

      const prefs = loadPreferences();
      
      expect(prefs).toEqual(getDefaultPreferences());
    });

    it('should validate thinkingLevel values', () => {
      const validLevels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high'];
      
      validLevels.forEach((level) => {
        localStorage.setItem(storageKey, JSON.stringify({
          ...getDefaultPreferences(),
          thinkingLevel: level,
        }));
        
        const prefs = loadPreferences();
        expect(prefs.thinkingLevel).toBe(level);
      });
    });

    it('should reject invalid thinkingLevel values', () => {
      localStorage.setItem(storageKey, JSON.stringify({
        thinkingLevel: 'super-high',
      }));

      const prefs = loadPreferences();
      
      expect(prefs.thinkingLevel).toBe('off');
    });
  });

  describe('savePreferences', () => {
    it('should save preferences to localStorage', () => {
      const prefs: CommandPreferences = {
        verbose: true,
        reasoningVisible: true,
        thinkingLevel: 'high',
      };

      savePreferences(prefs);

      const stored = JSON.parse(localStorage.getItem(storageKey)!);
      expect(stored).toEqual(prefs);
    });

    it('should handle localStorage being unavailable', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });

      const prefs: CommandPreferences = {
        verbose: true,
        reasoningVisible: true,
        thinkingLevel: 'high',
      };

      expect(() => savePreferences(prefs)).not.toThrow();
    });
  });

  describe('updatePreference', () => {
    it('should update a single preference value', () => {
      updatePreference('verbose', true);

      const prefs = loadPreferences();
      expect(prefs.verbose).toBe(true);
      expect(prefs.reasoningVisible).toBe(false);
      expect(prefs.thinkingLevel).toBe('off');
    });

    it('should preserve other preferences when updating one', () => {
      savePreferences({
        verbose: true,
        reasoningVisible: true,
        thinkingLevel: 'medium',
      });

      updatePreference('thinkingLevel', 'low');

      const prefs = loadPreferences();
      expect(prefs.verbose).toBe(true);
      expect(prefs.reasoningVisible).toBe(true);
      expect(prefs.thinkingLevel).toBe('low');
    });

    it('should handle updating thinkingLevel', () => {
      updatePreference('thinkingLevel', 'high');

      const prefs = loadPreferences();
      expect(prefs.thinkingLevel).toBe('high');
    });
  });

  describe('resetPreferences', () => {
    it('should reset all preferences to defaults', () => {
      savePreferences({
        verbose: true,
        reasoningVisible: true,
        thinkingLevel: 'high',
      });

      resetPreferences();

      const prefs = loadPreferences();
      expect(prefs).toEqual(getDefaultPreferences());
    });

    it('should work when no preferences are stored', () => {
      expect(() => resetPreferences()).not.toThrow();
      
      const prefs = loadPreferences();
      expect(prefs).toEqual(getDefaultPreferences());
    });
  });

  describe('corruption scenarios', () => {
    it('should handle non-object stored data', () => {
      localStorage.setItem(storageKey, '"string value"');
      
      const prefs = loadPreferences();
      expect(prefs).toEqual(getDefaultPreferences());
    });

    it('should handle number instead of boolean for verbose', () => {
      localStorage.setItem(storageKey, JSON.stringify({
        verbose: 1,
        reasoningVisible: 0,
        thinkingLevel: 'medium',
      }));
      
      const prefs = loadPreferences();
      expect(prefs.verbose).toBe(false);
      expect(prefs.reasoningVisible).toBe(false);
    });

    it('should handle object instead of string for thinkingLevel', () => {
      localStorage.setItem(storageKey, JSON.stringify({
        thinkingLevel: { level: 'high' },
      }));
      
      const prefs = loadPreferences();
      expect(prefs.thinkingLevel).toBe('off');
    });

    it('should handle empty object', () => {
      localStorage.setItem(storageKey, '{}');
      
      const prefs = loadPreferences();
      expect(prefs).toEqual(getDefaultPreferences());
    });

    it('should handle undefined values', () => {
      localStorage.setItem(storageKey, JSON.stringify({
        verbose: undefined,
        reasoningVisible: null,
        thinkingLevel: undefined,
      }));
      
      const prefs = loadPreferences();
      expect(prefs.verbose).toBe(false);
      expect(prefs.reasoningVisible).toBe(false);
      expect(prefs.thinkingLevel).toBe('off');
    });
  });
});
