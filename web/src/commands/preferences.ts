/**
 * Command preferences management
 * localStorage-backed preferences for command display behavior
 */

/** localStorage key for command preferences */
const PREFS_STORAGE_KEY = 'agent-platform.console.commandPrefs'

/** Valid thinking level values */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high'

/** Command preference configuration */
export interface CommandPreferences {
  /** Whether to show verbose command output */
  verbose: boolean
  /** Whether reasoning/thinking blocks are visible */
  reasoningVisible: boolean
  /** Level of thinking detail to display */
  thinkingLevel: ThinkingLevel
}

/** Default preferences when none exist or data is corrupted */
const DEFAULT_PREFERENCES: CommandPreferences = {
  verbose: false,
  reasoningVisible: false,
  thinkingLevel: 'off',
}

/**
 * Validates that an object is a valid ThinkingLevel
 */
function isValidThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && ['off', 'minimal', 'low', 'medium', 'high'].includes(value)
}

/**
 * Validates and sanitizes preferences object
 * Returns defaults for any invalid or missing fields
 */
function sanitizePreferences(data: unknown): CommandPreferences {
  if (!data || typeof data !== 'object') {
    return { ...DEFAULT_PREFERENCES }
  }

  const input = data as Record<string, unknown>

  return {
    verbose: typeof input.verbose === 'boolean' ? input.verbose : DEFAULT_PREFERENCES.verbose,
    reasoningVisible:
      typeof input.reasoningVisible === 'boolean' ? input.reasoningVisible : DEFAULT_PREFERENCES.reasoningVisible,
    thinkingLevel: isValidThinkingLevel(input.thinkingLevel) ? input.thinkingLevel : DEFAULT_PREFERENCES.thinkingLevel,
  }
}

/**
 * Loads command preferences from localStorage
 * Falls back to defaults if data is corrupted or unavailable
 *
 * @returns The current command preferences
 */
export function loadPreferences(): CommandPreferences {
  try {
    const stored = localStorage.getItem(PREFS_STORAGE_KEY)
    if (!stored) {
      return { ...DEFAULT_PREFERENCES }
    }

    const parsed = JSON.parse(stored)
    return sanitizePreferences(parsed)
  } catch {
    // Corrupted or unavailable localStorage - return defaults
    return { ...DEFAULT_PREFERENCES }
  }
}

/**
 * Saves command preferences to localStorage
 *
 * @param prefs - The preferences to save
 */
export function savePreferences(prefs: CommandPreferences): void {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // localStorage unavailable - preferences won't persist
    // This is acceptable for this feature
  }
}

/**
 * Updates a single preference value
 *
 * @param key - The preference key to update
 * @param value - The new value
 */
export function updatePreference<K extends keyof CommandPreferences>(key: K, value: CommandPreferences[K]): void {
  const prefs = loadPreferences()
  prefs[key] = value
  savePreferences(prefs)
}

/**
 * Resets all preferences to defaults
 */
export function resetPreferences(): void {
  savePreferences({ ...DEFAULT_PREFERENCES })
}

/**
 * Gets the default preferences (for testing or initialization)
 *
 * @returns A copy of the default preferences
 */
export function getDefaultPreferences(): CommandPreferences {
  return { ...DEFAULT_PREFERENCES }
}

/**
 * Gets the storage key used for preferences (for testing)
 *
 * @returns The localStorage key
 */
export function getPreferencesStorageKey(): string {
  return PREFS_STORAGE_KEY
}
