import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SettingsTab from './SettingsTab'
import ProviderTab from './ProviderTab'
import AgentTab from './AgentTab'
import { AuthProvider } from '../../context/AuthContext'
import * as client from '../../api/client'
import {
  getModalDestination,
  getModalComponent,
  isValidModalDestination,
} from './modal-destination-registry'

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
 * Every control/state/test id previously asserted on the system settings
 * overview (SettingsTab/SettingsContent). The overview may only retire once
 * every id here is proven to remain in SettingsTab or a named modal category.
 */
const OVERVIEW_TEST_IDS = [
  'settings-panel',
  'settings-loading',
  'settings-content',
  'local-only-yes',
  'retention-days',
  'theme-settings-section',
  'command-prefs-section',
  'pref-verbose',
  'pref-reasoning',
  'pref-thinking-level',
  'settings-save-error',
  'settings-notice',
] as const

describe('settings content parity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(client.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue([])
  })

  it('keeps every legacy overview test id when loaded', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-content')).toBeInTheDocument()
    })

    for (const testId of OVERVIEW_TEST_IDS) {
      if (testId === 'settings-loading' || testId === 'settings-save-error') {
        continue
      }
      expect(screen.getByTestId(testId)).toBeInTheDocument()
    }
  })

  it('keeps the overview loading state', () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}))

    renderWithAuth(<SettingsTab />)

    expect(screen.getByTestId('settings-loading')).toBeInTheDocument()
  })

  it('keeps the overview error state', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'))

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument()
    })
  })

  it('keeps the overview save-error surface on failed theme save', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)
    ;(client.updateSettings as ReturnType<typeof vi.fn>).mockRejectedValue(
      new client.ApiClientError({ code: 'SAVE_FAILED', message: '保存主题失败' }),
    )

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('theme-settings-section')).toBeInTheDocument()
    })

    const warmPaperRadio = screen.getByDisplayValue('warm-paper') as HTMLInputElement
    fireEvent.click(warmPaperRadio)

    await waitFor(() => {
      expect(screen.getByTestId('settings-save-error')).toBeInTheDocument()
    })
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
