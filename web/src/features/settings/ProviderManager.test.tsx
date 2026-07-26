import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ProviderManager from './ProviderManager'
import { AuthProvider } from '../../context/AuthContext'
import type { ProviderSummary, TestProviderResponse } from '../../api/types'

const mockProbeProviderModels = vi.fn<(_: { providerType: string; apiKey?: string; baseUrl?: string }) => Promise<TestProviderResponse>>()
const mockRefreshProviderModels = vi.fn<(_: string) => Promise<TestProviderResponse>>()
const mockGetProviders = vi.fn<() => Promise<ProviderSummary[]>>()
const mockCreateProvider = vi.fn<() => Promise<ProviderSummary>>()
const mockUpdateProvider = vi.fn<() => Promise<ProviderSummary>>()
const mockDeleteProvider = vi.fn<() => Promise<void>>()
const mockTestProvider = vi.fn<(_: string) => Promise<TestProviderResponse>>()

vi.mock('../../api/client', () => ({
  getProviders: (...args: unknown[]) => mockGetProviders(...args),
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
  updateProvider: (...args: unknown[]) => mockUpdateProvider(...args),
  deleteProvider: (...args: unknown[]) => mockDeleteProvider(...args),
  testProvider: (...args: unknown[]) => mockTestProvider(...args),
  probeProviderModels: (...args: unknown[]) => mockProbeProviderModels(...args),
  refreshProviderModels: (...args: unknown[]) => mockRefreshProviderModels(...args),
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

const mockProvider: ProviderSummary = {
  providerId: 'prov_123',
  providerType: 'openai',
  displayName: 'Test Provider',
  enabled: true,
  configured: true,
  apiKeyLast4: '1234',
  baseUrl: null,
  selectedModel: 'gpt-4',
  source: 'user',
  lastTestStatus: 'success',
  lastTestedAt: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const openAddModal = async () => {
  const addBtn = await screen.findByTestId('add-provider-btn')
  fireEvent.click(addBtn)
  await waitFor(() => {
    expect(screen.getByTestId('provider-modal')).toBeInTheDocument()
  })
}

const openEditModal = async (provider: ProviderSummary = mockProvider) => {
  const editBtn = await screen.findByTestId(`provider-edit-${provider.providerId}`)
  fireEvent.click(editBtn)
  await waitFor(() => {
    expect(screen.getByTestId('provider-modal')).toBeInTheDocument()
  })
}

const typeApiKey = (value: string) => {
  const input = screen.getByTestId('provider-api-key')
  fireEvent.change(input, { target: { value } })
}

const typeDisplayName = (value: string) => {
  const input = screen.getByTestId('provider-display-name')
  fireEvent.change(input, { target: { value } })
}

const submitForm = () => {
  const submitBtn = screen.getByTestId('modal-submit')
  fireEvent.click(submitBtn)
}

const advanceTimer = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

describe('ProviderManager model dropdown', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    mockGetProviders.mockResolvedValue([mockProvider])
    mockCreateProvider.mockResolvedValue(mockProvider)
    mockUpdateProvider.mockResolvedValue(mockProvider)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('populates select options after debounced credentials entry', async () => {
    mockProbeProviderModels.mockResolvedValue({
      success: true,
      latencyMs: 120,
      models: ['m1', 'm2'],
    })

    renderWithAuth(<ProviderManager isAuthenticated />)
    await openAddModal()

    typeApiKey('sk-test')

    await advanceTimer(500)

    await waitFor(() => {
      expect(mockProbeProviderModels).toHaveBeenCalledWith({
        providerType: 'openai',
        apiKey: 'sk-test',
      })
    })

    const select = screen.getByTestId('provider-model') as HTMLSelectElement
    await waitFor(() => {
      expect(select).toHaveValue('m1')
    })

    const options = Array.from(select.querySelectorAll('option'))
    const optionValues = options.map((o) => o.value)
    expect(optionValues).toContain('m1')
    expect(optionValues).toContain('m2')
  })

  it('calls refreshProviderModels when refresh button is clicked', async () => {
    mockRefreshProviderModels.mockResolvedValue({
      success: true,
      latencyMs: 80,
      models: ['x1', 'x2'],
    })

    const providerWithModels: ProviderSummary = {
      ...mockProvider,
      models: [{ modelId: 'existing-model' }],
    }
    mockGetProviders.mockResolvedValue([providerWithModels])

    renderWithAuth(<ProviderManager isAuthenticated />)
    await openEditModal(providerWithModels)

    const refreshBtn = screen.getByTestId('provider-models-refresh')
    fireEvent.click(refreshBtn)

    await waitFor(() => {
      expect(mockRefreshProviderModels).toHaveBeenCalledTimes(1)
      expect(mockRefreshProviderModels).toHaveBeenCalledWith(providerWithModels.providerId)
    })
  })

  it('auto-selects first model when selectedModel is empty and models arrive', async () => {
    mockProbeProviderModels.mockResolvedValue({
      success: true,
      latencyMs: 90,
      models: ['alpha', 'beta'],
    })

    renderWithAuth(<ProviderManager isAuthenticated />)
    await openAddModal()

    typeApiKey('sk-other')

    await advanceTimer(500)

    const select = screen.getByTestId('provider-model') as HTMLSelectElement
    await waitFor(() => {
      expect(select).toHaveValue('alpha')
    })
  })

  it('shows form error and empty select when probe fails', async () => {
    mockProbeProviderModels.mockResolvedValue({
      success: false,
      latencyMs: 0,
      error: 'Invalid API key',
    })

    renderWithAuth(<ProviderManager isAuthenticated />)
    await openAddModal()

    typeApiKey('sk-bad')

    await advanceTimer(500)

    await waitFor(() => {
      expect(screen.getByText('Invalid API key')).toBeInTheDocument()
    })

    const select = screen.getByTestId('provider-model') as HTMLSelectElement
    const options = Array.from(select.querySelectorAll('option'))
    expect(options.length).toBe(1)
    expect(options[0].value).toBe('')
  })

  it('loads models from provider.models on edit open without network call', async () => {
    const providerWithModels: ProviderSummary = {
      ...mockProvider,
      models: [{ modelId: 'glm-4' }, { modelId: 'glm-3' }],
    }
    mockGetProviders.mockResolvedValue([providerWithModels])

    renderWithAuth(<ProviderManager isAuthenticated />)
    await openEditModal(providerWithModels)

    expect(mockRefreshProviderModels).not.toHaveBeenCalled()

    const select = screen.getByTestId('provider-model') as HTMLSelectElement
    await waitFor(() => {
      const optionValues = Array.from(select.querySelectorAll('option')).map((o) => o.value)
      expect(optionValues).toContain('glm-4')
      expect(optionValues).toContain('glm-3')
    })
  })

  it('ignores stale probe responses when credentials change rapidly', async () => {
    mockProbeProviderModels.mockImplementation(async (body) => {
      if (body.apiKey === 'sk-first') {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return { success: true, latencyMs: 100, models: ['stale'] }
      }
      return { success: true, latencyMs: 50, models: ['fresh'] }
    })

    renderWithAuth(<ProviderManager isAuthenticated />)
    await openAddModal()

    typeApiKey('sk-first')
    await advanceTimer(500)

    typeApiKey('sk-second')
    await advanceTimer(500)

    await waitFor(() => {
      expect(mockProbeProviderModels).toHaveBeenCalledTimes(2)
    })

    await advanceTimer(1000)

    const select = screen.getByTestId('provider-model') as HTMLSelectElement
    await waitFor(() => {
      expect(select).toHaveValue('fresh')
    })

    const optionValues = Array.from(select.querySelectorAll('option')).map((o) => o.value)
    expect(optionValues).not.toContain('stale')
  })

  it('sends probed models in create payload', async () => {
    mockProbeProviderModels.mockResolvedValue({
      success: true,
      latencyMs: 100,
      models: ['m1', 'm2'],
    })

    renderWithAuth(<ProviderManager isAuthenticated />)
    await openAddModal()

    typeDisplayName('Probed Provider')
    typeApiKey('sk-test')

    await advanceTimer(500)

    const select = screen.getByTestId('provider-model') as HTMLSelectElement
    await waitFor(() => {
      expect(select).toHaveValue('m1')
    })

    submitForm()

    await waitFor(() => {
      expect(mockCreateProvider).toHaveBeenCalledTimes(1)
    })

    expect(mockCreateProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        displayName: 'Probed Provider',
        apiKey: 'sk-test',
        selectedModel: 'm1',
        models: [
          { modelId: 'm1', capabilities: { functionCalling: true, streaming: true, jsonMode: true } },
          { modelId: 'm2', capabilities: { functionCalling: true, streaming: true, jsonMode: true } },
        ],
      })
    )
  })

  it('allows creating Ollama provider without API Key when baseUrl is set', async () => {
    mockProbeProviderModels.mockResolvedValue({
      success: true,
      latencyMs: 100,
      models: ['llama3'],
    })

    renderWithAuth(<ProviderManager isAuthenticated />)
    await openAddModal()

    const typeSelect = screen.getByTestId('provider-type-select')
    fireEvent.change(typeSelect, { target: { value: 'ollama' } })

    typeDisplayName('Local Ollama')

    const baseUrlInput = screen.getByTestId('provider-base-url')
    fireEvent.change(baseUrlInput, { target: { value: 'http://localhost:11434' } })

    await advanceTimer(500)

    const select = screen.getByTestId('provider-model') as HTMLSelectElement
    await waitFor(() => {
      expect(select).toHaveValue('llama3')
    })

    submitForm()

    await waitFor(() => {
      expect(mockCreateProvider).toHaveBeenCalledTimes(1)
    })

    expect(mockCreateProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'ollama',
        displayName: 'Local Ollama',
        baseUrl: 'http://localhost:11434',
        selectedModel: 'llama3',
        models: [{ modelId: 'llama3', capabilities: { functionCalling: true, streaming: true, jsonMode: true } }],
      })
    )
    expect(mockCreateProvider).toHaveBeenCalledWith(expect.not.objectContaining({ apiKey: expect.anything() }))
  })
})
