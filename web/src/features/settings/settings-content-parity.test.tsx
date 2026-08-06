import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SettingsTab from './SettingsTab'
import ProviderTab from './ProviderTab'
import AgentTab from './AgentTab'
import { AuthProvider } from '../../context/AuthContext'
import * as client from '../../api/client'
import { getModalDestination, getModalComponent, isValidModalDestination } from './modal-destination-registry'

vi.mock('../../api/client', () => ({
  getSettings: vi.fn(),
  getProviders: vi.fn(),
  updateSettings: vi.fn(),
  getSubagentDefinitions: vi.fn(),
  getSubagentPreference: vi.fn(),
  updateSubagentPreference: vi.fn(),
  resetSubagentPreference: vi.fn(),
  ApiClientError: class ApiClientError extends Error {
    code: string
    status?: number
    constructor(error: { code: string; message: string }, status?: number) {
      super(error.message)
      this.name = 'ApiClientError'
      this.code = error.code
      this.status = status
    }
  },
}))

const renderWithAuth = (component: React.ReactElement) => {
  return render(<AuthProvider>{component}</AuthProvider>)
}

const mockSettings = {
  settings: {
    localOnly: true,
    providers: {},
    retentionDays: 30,
    theme: 'default',
    commandPrefs: {
      verbose: false,
      reasoningVisible: false,
      thinkingLevel: 'off',
    },
  },
}

/**
 * Contract after the settings overview (SettingsTab) retired the single-page
 * SettingsContent: the overview keeps its panel/notice/category-nav surface,
 * and the four settings categories keep their own tab test ids. The legacy
 * read-only rows (local-only-yes, retention-days) and the single-page sections
 * (theme-settings-section, settings-save-error) are intentionally gone.
 */
const OVERVIEW_TEST_IDS = [
  'settings-panel',
  'settings-notice',
  'settings-nav-settings-general',
  'settings-nav-settings-appearance',
  'settings-nav-settings-provider',
  'settings-nav-settings-agent',
] as const

describe('settings content parity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(client.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue([])
  })

  it('keeps the overview surface and category navigation when loaded', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
    })

    for (const testId of OVERVIEW_TEST_IDS) {
      expect(screen.getByTestId(testId)).toBeInTheDocument()
    }
  })

  it('keeps the command preferences surface via the general category in fallback mode', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-general-tab')).toBeInTheDocument()
    })

    expect(screen.getByTestId('command-prefs-section')).toBeInTheDocument()
    expect(screen.getByTestId('pref-verbose')).toBeInTheDocument()
    expect(screen.getByTestId('pref-reasoning')).toBeInTheDocument()
    expect(screen.getByTestId('pref-thinking-level')).toBeInTheDocument()
  })

  it('keeps the overview loading state', () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}))

    renderWithAuth(<SettingsTab />)

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('keeps the overview error state', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'))

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument()
    })
  })

  it('renders the appearance category with theme options in fallback mode', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('settings-nav-settings-appearance'))

    await waitFor(() => {
      expect(screen.getByTestId('settings-appearance-tab')).toBeInTheDocument()
    })
    expect(screen.getByTestId('theme-option-default')).toBeInTheDocument()
  })

  it('keeps the provider and agent surfaces as named modal categories', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)
    ;(client.getSubagentDefinitions as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const providerEntry = getModalDestination('settings-provider')
    const agentEntry = getModalDestination('settings-agent')
    expect(providerEntry?.isSettingsCategory).toBe(true)
    expect(agentEntry?.isSettingsCategory).toBe(true)
    expect(getModalComponent('settings-provider')).toBe(ProviderTab)
    expect(getModalComponent('settings-agent')).toBe(AgentTab)

    renderWithAuth(
      <>
        <ProviderTab />
        <AgentTab />
      </>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('settings-provider-tab')).toBeInTheDocument()
    })
    expect(screen.getByTestId('settings-agent-tab')).toBeInTheDocument()
  })

  it('rejects ids outside the parity contract without opening unrelated tabs', () => {
    expect(isValidModalDestination('session-console')).toBe(false)
    expect(getModalDestination('settings')).not.toBeNull()
    expect(getModalDestination('settings')?.isSettingsCategory).toBe(false)
    expect(getModalDestination('not-a-real-destination')).toBeNull()
  })
})
