/**
 * Theme Storage Helper
 *
 * Provides safe localStorage access for theme storage with exception handling
 * and theme validation.
 */

export type AppTheme = 'default' | 'warm-paper' | 'dark'

export const THEME_STORAGE_KEY = 'agent-platform-theme'

const APP_THEMES = new Set<AppTheme>(['default', 'warm-paper', 'dark'])

/**
 * Safely reads the stored theme from localStorage.
 * Returns 'default' if:
 * - localStorage throws an exception (e.g., private mode, SSR)
 * - localStorage returns null (no stored value)
 * - localStorage returns an invalid/unknown theme
 * - localStorage returns an empty string
 *
 * @returns The stored theme if valid, 'default' otherwise
 */
export function readStoredTheme(): AppTheme {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)

    // Return default for null or empty strings
    if (storedTheme === null || storedTheme.trim() === '') {
      return 'default'
    }

    // Validate theme is one of the allowed values
    return APP_THEMES.has(storedTheme as AppTheme) ? (storedTheme as AppTheme) : 'default'
  } catch (error) {
    // localStorage may be unavailable in some environments (e.g., SSR, private mode)
    console.warn(`Failed to read theme from localStorage:`, error)
    return 'default'
  }
}

/**
 * Applies the theme to the document by setting data-theme attribute.
 *
 * @param theme - The theme to apply
 */
export function applyDocumentTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme
}
