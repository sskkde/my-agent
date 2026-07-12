import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ModelSelector from './ModelSelector'
import type { ModelsResponse } from '../../../api/types'

const mockModelsData: ModelsResponse = {
  providers: [
    {
      providerId: 'openai',
      providerType: 'openai',
      displayName: 'OpenAI',
      enabled: true,
      configured: true,
      apiKeyLast4: '1234',
      baseUrl: 'https://api.openai.com',
      selectedModel: 'gpt-4.1',
      source: 'env',
      lastTestStatus: 'ok',
      lastTestedAt: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      providerId: 'ollama',
      providerType: 'ollama',
      displayName: 'Ollama',
      enabled: true,
      configured: false,
      apiKeyLast4: null,
      baseUrl: 'http://localhost:11434',
      selectedModel: null,
      defaultModel: 'llama2',
      source: 'user',
      lastTestStatus: null,
      lastTestedAt: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      providerId: 'deepseek',
      providerType: 'deepseek',
      displayName: 'DeepSeek',
      enabled: false,
      configured: true,
      apiKeyLast4: '5678',
      baseUrl: 'https://api.deepseek.com',
      selectedModel: 'deepseek-chat',
      source: 'user',
      lastTestStatus: null,
      lastTestedAt: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ],
  selectedModel: 'gpt-4.1',
  selectedProviderId: 'openai',
}

const baseProps = {
  model: 'gpt-4.1',
  status: 'idle',
  sessionId: 'session-1',
  disabled: false,
  onOpen: vi.fn(),
  onSelect: vi.fn(),
  onClose: vi.fn(),
}

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the trigger with the current model', () => {
    render(<ModelSelector {...baseProps} isOpen={false} />)
    const trigger = screen.getByTestId('chat-model-selector-trigger')
    expect(trigger).toHaveTextContent('gpt-4.1')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the popover and calls onOpen when clicked', () => {
    render(<ModelSelector {...baseProps} isOpen={false} />)
    fireEvent.click(screen.getByTestId('chat-model-selector-trigger'))
    expect(baseProps.onOpen).toHaveBeenCalledTimes(1)
  })

  it('closes the popover and calls onClose when trigger is clicked while open', () => {
    render(<ModelSelector {...baseProps} isOpen modelsData={mockModelsData} />)
    fireEvent.click(screen.getByTestId('chat-model-selector-trigger'))
    expect(baseProps.onClose).toHaveBeenCalledTimes(1)
  })

  it('renders provider groups and candidate models', () => {
    render(<ModelSelector {...baseProps} isOpen modelsData={mockModelsData} />)
    expect(screen.getByTestId('chat-model-provider-openai')).toBeInTheDocument()
    expect(screen.getByTestId('chat-model-provider-ollama')).toBeInTheDocument()
    expect(screen.getByTestId('chat-model-provider-deepseek')).toBeInTheDocument()
    expect(screen.getByTestId('chat-model-option-openai')).toHaveTextContent('gpt-4.1')
    expect(screen.getByTestId('chat-model-option-ollama')).toHaveTextContent('llama2')
  })

  it('marks the current selection as aria-selected', () => {
    render(<ModelSelector {...baseProps} isOpen modelsData={mockModelsData} />)
    expect(screen.getByTestId('chat-model-option-openai')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('chat-model-option-ollama')).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onSelect when a selectable option is clicked', () => {
    render(<ModelSelector {...baseProps} isOpen modelsData={mockModelsData} />)
    fireEvent.click(screen.getByTestId('chat-model-option-openai'))
    expect(baseProps.onSelect).toHaveBeenCalledWith('openai', 'gpt-4.1')
  })

  it('disables options for providers that are not configured or not enabled', () => {
    render(<ModelSelector {...baseProps} isOpen modelsData={mockModelsData} />)
    expect(screen.getByTestId('chat-model-option-ollama')).toBeDisabled()
    expect(screen.getByTestId('chat-model-option-deepseek')).toBeDisabled()
  })

  it('disables the trigger when no session is selected', () => {
    render(<ModelSelector {...baseProps} sessionId={null} isOpen={false} />)
    expect(screen.getByTestId('chat-model-selector-trigger')).toBeDisabled()
  })

  it('disables the trigger when disabled prop is true', () => {
    render(<ModelSelector {...baseProps} disabled isOpen={false} />)
    expect(screen.getByTestId('chat-model-selector-trigger')).toBeDisabled()
  })

  it('shows a loading state', () => {
    render(<ModelSelector {...baseProps} isOpen modelsLoading />)
    expect(screen.getByTestId('chat-model-loading')).toBeInTheDocument()
  })

  it('shows an error state with a retry button', () => {
    render(<ModelSelector {...baseProps} isOpen modelsError="加载失败" />)
    expect(screen.getByTestId('chat-model-error')).toHaveTextContent('加载失败')
    fireEvent.click(screen.getByTestId('chat-model-retry'))
    expect(baseProps.onOpen).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state when no providers are available', () => {
    render(<ModelSelector {...baseProps} isOpen modelsData={{ providers: [] }} />)
    expect(screen.getByTestId('chat-model-empty')).toBeInTheDocument()
  })

  it('closes on Escape key', () => {
    render(<ModelSelector {...baseProps} isOpen modelsData={mockModelsData} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(baseProps.onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on outside click', () => {
    render(
      <div data-testid="outside">
        <ModelSelector {...baseProps} isOpen modelsData={mockModelsData} />
      </div>,
    )
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(baseProps.onClose).toHaveBeenCalledTimes(1)
  })
})
