import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SettingsTab from './SettingsTab'
import { AuthProvider } from '../../context/AuthContext'
import * as client from '../../api/client'

vi.mock('../../api/client', () => ({
  getSettings: vi.fn(),
  getProviders: vi.fn(),
  updateSettings: vi.fn(),
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

describe('SettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(client.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue([])
  })

  it('renders settings panel with data-testid', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
    })
  })

  it('lists the four settings categories as navigation rows', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
    })

    expect(screen.getByTestId('settings-nav-settings-general')).toBeInTheDocument()
    expect(screen.getByTestId('settings-nav-settings-appearance')).toBeInTheDocument()
    expect(screen.getByTestId('settings-nav-settings-provider')).toBeInTheDocument()
    expect(screen.getByTestId('settings-nav-settings-agent')).toBeInTheDocument()
  })

  it('delegates category clicks to onTabChange when provided', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)
    const onTabChange = vi.fn()

    renderWithAuth(<SettingsTab onTabChange={onTabChange} />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-nav-settings-appearance')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('settings-nav-settings-appearance'))

    expect(onTabChange).toHaveBeenCalledWith('settings-appearance')
    expect(screen.queryByTestId('settings-general-tab')).not.toBeInTheDocument()
  })

  it('falls back to in-panel rendering of the general category without onTabChange', async () => {
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

  it('switches to the appearance category in fallback mode', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-general-tab')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('settings-nav-settings-appearance'))

    await waitFor(() => {
      expect(screen.getByTestId('settings-appearance-tab')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('settings-general-tab')).not.toBeInTheDocument()
  })

  it('shows security notice', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-notice')).toBeInTheDocument()
    })

    expect(screen.getByText(/安全提示/)).toBeInTheDocument()
    expect(screen.getByText(/API 密钥/)).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}))

    renderWithAuth(<SettingsTab />)

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('shows error state on API failure', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'))

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument()
    })
  })

  it('calls updateSettings when toggling verbose preference', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)
    ;(client.updateSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      settings: {
        ...mockSettings.settings,
        commandPrefs: { verbose: true, reasoningVisible: false, thinkingLevel: 'off' },
      },
    })

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('pref-verbose')).toBeInTheDocument()
    })

    const verboseToggle = screen.getByTestId('pref-verbose') as HTMLInputElement
    fireEvent.click(verboseToggle)

    await waitFor(() => {
      expect(client.updateSettings).toHaveBeenCalledWith({
        commandPrefs: { verbose: true, reasoningVisible: false, thinkingLevel: 'off' },
      })
    })
  })

  it('calls updateSettings when changing theme in the appearance category', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)
    ;(client.updateSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      settings: {
        ...mockSettings.settings,
        theme: 'warm-paper',
      },
    })

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-general-tab')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('settings-nav-settings-appearance'))

    await waitFor(() => {
      expect(screen.getByTestId('theme-option-warm-paper')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('theme-option-warm-paper'))

    await waitFor(() => {
      expect(client.updateSettings).toHaveBeenCalledWith({ theme: 'warm-paper' })
    })
  })
})
