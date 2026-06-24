import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import AgentsTab from './AgentsTab'
import * as client from '../../api/client'
import type { AgentConfig, ProviderSummary, ToolsResponse, SkillsResponse } from '../../api/types'

vi.mock('../../api/client')

const mockGetAgentConfig = vi.mocked(client.getAgentConfig)
const mockGetProviders = vi.mocked(client.getProviders)
const mockGetTools = vi.mocked(client.getTools)
const mockGetSkills = vi.mocked(client.getSkills)
const mockUpdateAgentConfig = vi.mocked(client.updateAgentConfig)
const mockResetAgentConfigOverride = vi.mocked(client.resetAgentConfigOverride)

describe('AgentsTab', () => {
  const mockConfig: AgentConfig = {
    agentId: 'foreground.default',
    global: {
      providerId: 'openai',
      model: 'gpt-4',
      systemPrompt: '',
      routingPrompt: '',
      allowedToolIds: ['read_file', 'write_file'],
      allowedSkillIds: ['git'],
      routingTimeoutMs: 30000,
      repairAttempts: 1,
    },
    userOverride: null,
    effective: {
      providerId: 'openai',
      model: 'gpt-4',
      systemPrompt: '',
      routingPrompt: '',
      allowedToolIds: ['read_file', 'write_file'],
      allowedSkillIds: ['git'],
      routingTimeoutMs: 30000,
      repairAttempts: 1,
    },
  }

  const mockProviders: ProviderSummary[] = [
    {
      providerId: 'openai',
      providerType: 'openai',
      displayName: 'OpenAI',
      enabled: true,
      configured: true,
      apiKeyLast4: '1234',
      baseUrl: null,
      selectedModel: 'gpt-4',
      source: 'env',
      lastTestStatus: 'success',
      lastTestedAt: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      providerId: 'ollama',
      providerType: 'ollama',
      displayName: 'Ollama Local',
      enabled: true,
      configured: true,
      apiKeyLast4: null,
      baseUrl: 'http://localhost:11434',
      selectedModel: 'llama2',
      source: 'custom',
      lastTestStatus: null,
      lastTestedAt: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ]

  const mockTools: ToolsResponse = {
    tools: [
      {
        name: 'artifact_create',
        description: 'Create a new artifact with the given title and content',
        category: 'write',
        sensitivity: 'medium',
      },
      {
        name: 'memory_retrieve',
        description: 'Retrieve memory records from session or user memory',
        category: 'read',
        sensitivity: 'medium',
      },
      {
        name: 'web_search',
        description: 'Search the public web for information using an external search provider',
        category: 'search',
        sensitivity: 'medium',
      },
      { name: 'read_file', description: 'Read file contents', category: 'read', sensitivity: 'low' },
      { name: 'write_file', description: 'Write file contents', category: 'write', sensitivity: 'medium' },
      { name: 'execute_command', description: 'Execute shell command', category: 'execute', sensitivity: 'high' },
    ],
    total: 6,
  }

  const mockSkills: SkillsResponse = {
    skills: [
      { skillId: 'artifact_create', name: 'artifact_create', description: 'Create artifacts', category: 'write', sensitivity: 'medium', enabled: true, source: 'builtin' },
      { skillId: 'memory_retrieve', name: 'memory_retrieve', description: 'Retrieve memory', category: 'read', sensitivity: 'medium', enabled: true, source: 'builtin' },
      { skillId: 'git', name: 'Git', description: 'Git version control', category: 'automation', sensitivity: 'low', enabled: true, source: 'user' },
      { skillId: 'docker', name: 'Docker', description: 'Docker container management', category: 'automation', sensitivity: 'medium', enabled: true, source: 'user' },
      { skillId: 'custom-skill', name: 'Custom Skill', description: 'A custom skill', category: 'custom', sensitivity: 'low', enabled: false, source: 'user' },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAgentConfig.mockResolvedValue(mockConfig)
    mockGetProviders.mockResolvedValue(mockProviders)
    mockGetTools.mockResolvedValue(mockTools)
    mockGetSkills.mockResolvedValue(mockSkills)
  })

  describe('Loading State', () => {
    it('should show loading state initially', () => {
      render(<AgentsTab />)
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('should show error message when API fails', async () => {
      mockGetAgentConfig.mockRejectedValue(new Error('API Error'))
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('agents-error')).toBeInTheDocument()
      })
    })

    it('should show retry button on error', async () => {
      mockGetAgentConfig.mockRejectedValue(new Error('API Error'))
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('agents-retry-btn')).toBeInTheDocument()
      })
    })

    it('should retry loading when retry button clicked', async () => {
      mockGetAgentConfig.mockRejectedValueOnce(new Error('API Error'))
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('agents-retry-btn')).toBeInTheDocument()
      })

      mockGetAgentConfig.mockResolvedValueOnce(mockConfig)
      fireEvent.click(screen.getByTestId('agents-retry-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('agents-panel')).toBeInTheDocument()
      })
    })
  })

  describe('Loaded State', () => {
    it('should render the agents panel', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('agents-panel')).toBeInTheDocument()
      })
    })

    it('should display scope selector', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('scope-selector')).toBeInTheDocument()
        expect(screen.getByTestId('scope-global-btn')).toBeInTheDocument()
        expect(screen.getByTestId('scope-override-btn')).toBeInTheDocument()
      })
    })

    it('should display provider dropdown', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('provider-select')).toBeInTheDocument()
      })
    })

    it('should display model input', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('model-input')).toBeInTheDocument()
      })
    })

    it('should display prompt textareas', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('system-prompt-textarea')).toBeInTheDocument()
        expect(screen.getByTestId('routing-prompt-textarea')).toBeInTheDocument()
      })
    })

    it('should display tools multi-select', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('tools-multi-select')).toBeInTheDocument()
      })
    })

    it('should display localized built-in tool names while preserving English IDs', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('tools-multi-select')).toBeInTheDocument()
      })

      const toolsList = within(screen.getByTestId('tools-multi-select'))
      expect(toolsList.getByText('创建工件')).toBeInTheDocument()
      expect(toolsList.getByText('(artifact_create)')).toBeInTheDocument()
      expect(toolsList.getByText('检索记忆')).toBeInTheDocument()
      expect(toolsList.getByText('(memory_retrieve)')).toBeInTheDocument()
      expect(toolsList.getByText('网络搜索')).toBeInTheDocument()
      expect(toolsList.getByText('(web_search)')).toBeInTheDocument()
      expect(toolsList.getByText('使用指定标题和内容创建新的工件。')).toBeInTheDocument()
    })

    it('should fall back to original tool name and description for unknown tools', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('tools-multi-select')).toBeInTheDocument()
      })

      const toolsList = within(screen.getByTestId('tools-multi-select'))
      expect(toolsList.getByText('read_file')).toBeInTheDocument()
      expect(toolsList.getByText('(read_file)')).toBeInTheDocument()
      expect(toolsList.getByText('Read file contents')).toBeInTheDocument()
    })

    it('should display skills multi-select', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('skills-multi-select')).toBeInTheDocument()
      })
    })

    it('should display localized built-in skill names while preserving English IDs', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('skills-multi-select')).toBeInTheDocument()
      })

      const skillsList = within(screen.getByTestId('skills-multi-select'))
      expect(skillsList.getByText('创建工件')).toBeInTheDocument()
      expect(skillsList.getByText('(artifact_create)')).toBeInTheDocument()
      expect(skillsList.getByText('检索记忆')).toBeInTheDocument()
      expect(skillsList.getByText('(memory_retrieve)')).toBeInTheDocument()
      expect(skillsList.getByText('使用指定标题和内容创建新的工件。')).toBeInTheDocument()
    })

    it('should fall back to original skill name while preserving the skill ID', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('skills-multi-select')).toBeInTheDocument()
      })

      const skillsList = within(screen.getByTestId('skills-multi-select'))
      expect(skillsList.getByText('Git')).toBeInTheDocument()
      expect(skillsList.getByText('(git)')).toBeInTheDocument()
    })

    it('should display timeout input', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('timeout-input')).toBeInTheDocument()
      })
    })

    it('should display save and reset buttons', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('agents-save-btn')).toBeInTheDocument()
        expect(screen.getByTestId('agents-reset-btn')).toBeInTheDocument()
      })
    })

    it('should display effective config', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('effective-provider')).toBeInTheDocument()
        expect(screen.getByTestId('effective-model')).toBeInTheDocument()
        expect(screen.getByTestId('effective-timeout')).toBeInTheDocument()
        expect(screen.getByTestId('effective-tools')).toBeInTheDocument()
        expect(screen.getByTestId('effective-skills')).toBeInTheDocument()
        expect(screen.getByTestId('effective-override')).toBeInTheDocument()
      })
    })
  })

  describe('Form Interactions', () => {
    it('should update model input value', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('model-input')).toBeInTheDocument()
      })

      const input = screen.getByTestId('model-input')
      fireEvent.change(input, { target: { value: 'gpt-3.5-turbo' } })

      expect(input).toHaveValue('gpt-3.5-turbo')
    })

    it('should update timeout input value', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('timeout-input')).toBeInTheDocument()
      })

      const input = screen.getByTestId('timeout-input')
      fireEvent.change(input, { target: { value: '600' } })

      expect(input).toHaveValue(600)
    })

    it('should toggle tool checkboxes', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('tool-checkbox-read_file')).toBeInTheDocument()
      })

      const checkbox = screen.getByTestId('tool-checkbox-read_file')
      fireEvent.click(checkbox)

      expect(checkbox).not.toBeChecked()
    })

    it('should toggle skill checkboxes', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('skill-checkbox-git')).toBeInTheDocument()
      })

      const checkbox = screen.getByTestId('skill-checkbox-git')
      fireEvent.click(checkbox)

      expect(checkbox).not.toBeChecked()
    })

    it('should select all tools when select all clicked', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('select-all-tools-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('select-all-tools-btn'))

      expect(screen.getByTestId('tool-checkbox-read_file')).toBeChecked()
      expect(screen.getByTestId('tool-checkbox-write_file')).toBeChecked()
      expect(screen.getByTestId('tool-checkbox-execute_command')).toBeChecked()
    })

    it('should deselect all tools when deselect all clicked', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('deselect-all-tools-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('deselect-all-tools-btn'))

      expect(screen.getByTestId('tool-checkbox-read_file')).not.toBeChecked()
      expect(screen.getByTestId('tool-checkbox-write_file')).not.toBeChecked()
    })

    it('should select all skills when select all clicked', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('select-all-skills-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('select-all-skills-btn'))

      expect(screen.getByTestId('skill-checkbox-git')).toBeChecked()
      expect(screen.getByTestId('skill-checkbox-docker')).toBeChecked()
      expect(screen.getByTestId('skill-checkbox-custom-skill')).toBeChecked()
    })

    it('should deselect all skills when deselect all clicked', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('deselect-all-skills-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('deselect-all-skills-btn'))

      expect(screen.getByTestId('skill-checkbox-git')).not.toBeChecked()
      expect(screen.getByTestId('skill-checkbox-docker')).not.toBeChecked()
    })
  })

  describe('Scope Switching', () => {
    it('should switch to override scope when override button clicked', async () => {
      const configWithOverride: AgentConfig = {
        ...mockConfig,
        userOverride: {
          providerId: 'ollama',
          model: 'llama2',
          systemPrompt: '',
          routingPrompt: '',
          allowedToolIds: ['read_file'],
          allowedSkillIds: [],
          routingTimeoutMs: 30000,
          repairAttempts: 1,
        },
      }
      mockGetAgentConfig.mockResolvedValue(configWithOverride)

      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('scope-override-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('scope-override-btn'))

      expect(screen.getByTestId('scope-override-btn')).toHaveClass('active')
    })

    it('should switch to global scope when global button clicked', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('scope-global-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('scope-override-btn'))
      fireEvent.click(screen.getByTestId('scope-global-btn'))

      expect(screen.getByTestId('scope-global-btn')).toHaveClass('active')
    })
  })

  describe('Save Functionality', () => {
    it('should show validation error when provider not selected', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('agents-save-btn')).toBeInTheDocument()
      })

      const providerSelect = screen.getByTestId('provider-select')
      fireEvent.change(providerSelect, { target: { value: '' } })

      fireEvent.click(screen.getByTestId('agents-save-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('agents-save-error')).toBeInTheDocument()
      })
    })

    it('should show validation error when model is empty', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('agents-save-btn')).toBeInTheDocument()
      })

      const modelInput = screen.getByTestId('model-input')
      fireEvent.change(modelInput, { target: { value: '' } })

      fireEvent.click(screen.getByTestId('agents-save-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('agents-save-error')).toBeInTheDocument()
      })
    })

    it('should call updateAgentConfig when save clicked with valid data', async () => {
      mockUpdateAgentConfig.mockResolvedValue(mockConfig.global)

      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('agents-save-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('agents-save-btn'))

      await waitFor(() => {
        expect(mockUpdateAgentConfig).toHaveBeenCalledWith(
          'foreground.default',
          'global',
          expect.objectContaining({
            providerId: 'openai',
            model: 'gpt-4',
            routingTimeoutMs: 30000,
            repairAttempts: 1,
          }),
        )
      })
    })

    it('should omit inherited timeout and repair fields when saving an untouched override', async () => {
      const configWithInheritedOverride: AgentConfig = {
        ...mockConfig,
        global: {
          ...mockConfig.global,
          routingTimeoutMs: 60000,
          repairAttempts: 1,
        },
        userOverride: {
          providerId: 'ollama',
          model: 'llama2',
          systemPrompt: '',
          routingPrompt: '',
          allowedToolIds: ['read_file'],
          allowedSkillIds: [],
        },
        effective: {
          providerId: 'ollama',
          model: 'llama2',
          systemPrompt: '',
          routingPrompt: '',
          allowedToolIds: ['read_file'],
          allowedSkillIds: [],
          routingTimeoutMs: 60000,
          repairAttempts: 1,
        },
      }
      mockGetAgentConfig.mockResolvedValue(configWithInheritedOverride)
      mockUpdateAgentConfig.mockResolvedValue(configWithInheritedOverride.userOverride!)

      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('scope-override-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('scope-override-btn'))

      expect(screen.getByTestId('timeout-input')).toHaveValue(60)
      fireEvent.click(screen.getByTestId('agents-save-btn'))

      await waitFor(() => {
        expect(mockUpdateAgentConfig).toHaveBeenCalled()
      })
      const payload = mockUpdateAgentConfig.mock.calls[0]![2]
      expect(mockUpdateAgentConfig).toHaveBeenCalledWith(
        'foreground.default',
        'override',
        expect.objectContaining({
          providerId: 'ollama',
          model: 'llama2',
        }),
      )
      expect(payload).not.toHaveProperty('routingTimeoutMs')
      expect(payload).not.toHaveProperty('repairAttempts')
    })

    it('should send timeout when override timeout is explicitly changed', async () => {
      const configWithInheritedOverride: AgentConfig = {
        ...mockConfig,
        userOverride: {
          providerId: 'ollama',
          model: 'llama2',
          systemPrompt: '',
          routingPrompt: '',
          allowedToolIds: ['read_file'],
          allowedSkillIds: [],
        },
        effective: {
          providerId: 'ollama',
          model: 'llama2',
          systemPrompt: '',
          routingPrompt: '',
          allowedToolIds: ['read_file'],
          allowedSkillIds: [],
          routingTimeoutMs: 60000,
          repairAttempts: 1,
        },
      }
      mockGetAgentConfig.mockResolvedValue(configWithInheritedOverride)
      mockUpdateAgentConfig.mockResolvedValue(configWithInheritedOverride.userOverride!)

      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('scope-override-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('scope-override-btn'))
      fireEvent.change(screen.getByTestId('timeout-input'), { target: { value: '45' } })
      fireEvent.click(screen.getByTestId('agents-save-btn'))

      await waitFor(() => {
        expect(mockUpdateAgentConfig).toHaveBeenCalled()
      })
      const payload = mockUpdateAgentConfig.mock.calls[0]![2]
      expect(payload).toHaveProperty('routingTimeoutMs', 45000)
      expect(payload).not.toHaveProperty('repairAttempts')
    })

    it('should show saving state during save', async () => {
      mockUpdateAgentConfig.mockImplementation(() => new Promise(() => {}))

      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('agents-save-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('agents-save-btn'))

      expect(screen.getByTestId('agents-save-btn')).toHaveTextContent('保存中...')
      expect(screen.getByTestId('agents-save-btn')).toBeDisabled()
    })
  })

  describe('Reset Functionality', () => {
    it('should call resetAgentConfigOverride when reset clicked with override', async () => {
      const configWithOverride: AgentConfig = {
        ...mockConfig,
        userOverride: {
          providerId: 'ollama',
          model: 'llama2',
          systemPrompt: '',
          routingPrompt: '',
          allowedToolIds: ['read_file'],
          allowedSkillIds: [],
          routingTimeoutMs: 30000,
          repairAttempts: 1,
        },
      }
      mockGetAgentConfig.mockResolvedValue(configWithOverride)
      mockResetAgentConfigOverride.mockResolvedValue({ success: true })

      vi.spyOn(window, 'confirm').mockReturnValue(true)

      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('agents-reset-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('agents-reset-btn'))

      await waitFor(() => {
        expect(mockResetAgentConfigOverride).toHaveBeenCalledWith('foreground.default')
      })
    })

    it('should show resetting state during reset', async () => {
      const configWithOverride: AgentConfig = {
        ...mockConfig,
        userOverride: {
          providerId: 'ollama',
          model: 'llama2',
          systemPrompt: '',
          routingPrompt: '',
          allowedToolIds: ['read_file'],
          allowedSkillIds: [],
          routingTimeoutMs: 30000,
          repairAttempts: 1,
        },
      }
      mockGetAgentConfig.mockResolvedValue(configWithOverride)
      mockResetAgentConfigOverride.mockImplementation(() => new Promise(() => {}))

      vi.spyOn(window, 'confirm').mockReturnValue(true)

      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('agents-reset-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('agents-reset-btn'))

      expect(screen.getByTestId('agents-reset-btn')).toHaveTextContent('重置中...')
      expect(screen.getByTestId('agents-reset-btn')).toBeDisabled()
    })
  })

  describe('Effective Config Display', () => {
    it('should show correct provider in effective config', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('effective-provider')).toBeInTheDocument()
      })

      expect(screen.getByTestId('effective-provider')).toHaveTextContent('OpenAI')
    })

    it('should show correct model in effective config', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('effective-model')).toBeInTheDocument()
      })

      expect(screen.getByTestId('effective-model')).toHaveTextContent('gpt-4')
    })

    it('should show correct timeout in effective config', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('effective-timeout')).toBeInTheDocument()
      })

      // routingTimeoutMs is 30000 (30 seconds), displayed as "30 秒"
      expect(screen.getByTestId('effective-timeout')).toHaveTextContent('30 秒')
    })

    it('should show override status when no override exists', async () => {
      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('effective-override')).toBeInTheDocument()
      })

      expect(screen.getByTestId('effective-override')).toHaveTextContent('未设置')
    })

    it('should show override status when override exists', async () => {
      const configWithOverride: AgentConfig = {
        ...mockConfig,
        userOverride: {
          providerId: 'ollama',
          model: 'llama2',
          systemPrompt: '',
          routingPrompt: '',
          allowedToolIds: ['read_file'],
          allowedSkillIds: [],
          routingTimeoutMs: 30000,
          repairAttempts: 1,
        },
      }
      mockGetAgentConfig.mockResolvedValue(configWithOverride)

      render(<AgentsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('effective-override')).toBeInTheDocument()
      })

      expect(screen.getByTestId('effective-override')).toHaveTextContent('已启用')
      expect(screen.getByTestId('effective-override')).toHaveClass('has-override')
    })
  })
})
