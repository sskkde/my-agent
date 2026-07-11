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

  it('shows loading state initially', () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}))

    renderWithAuth(<SettingsTab />)

    expect(screen.getByTestId('settings-loading')).toBeInTheDocument()
  })

  it('shows settings content with correct data', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-content')).toBeInTheDocument()
    })

    expect(screen.getByTestId('local-only-yes')).toBeInTheDocument()
    expect(screen.getByTestId('retention-days')).toHaveTextContent('30 天')
  })

  it('shows error state on API failure', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'))

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument()
    })
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

  it('renders command preferences section', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('command-prefs-section')).toBeInTheDocument()
    })

    expect(screen.getByTestId('pref-verbose')).toBeInTheDocument()
    expect(screen.getByTestId('pref-reasoning')).toBeInTheDocument()
    expect(screen.getByTestId('pref-thinking-level')).toBeInTheDocument()
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

  it('calls updateSettings when changing theme', async () => {
    ;(client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings)
    ;(client.updateSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      settings: {
        ...mockSettings.settings,
        theme: 'warm-paper',
      },
    })

    renderWithAuth(<SettingsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('theme-settings-section')).toBeInTheDocument()
    })

    const warmPaperRadio = screen.getByDisplayValue('warm-paper') as HTMLInputElement
    fireEvent.click(warmPaperRadio)

    await waitFor(() => {
      expect(client.updateSettings).toHaveBeenCalledWith({ theme: 'warm-paper' })
    })
  })
})