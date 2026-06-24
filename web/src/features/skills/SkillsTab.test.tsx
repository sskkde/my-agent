import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SkillsTab from './SkillsTab'
import * as client from '../../api/client'

vi.mock('../../api/client', () => ({
  getSkills: vi.fn(),
}))

describe('SkillsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders skills panel with data-testid', async () => {
    ;(client.getSkills as ReturnType<typeof vi.fn>).mockResolvedValue({
      skills: [],
    })

    render(<SkillsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('skills-panel')).toBeInTheDocument()
    })
  })

  it('shows loading state initially', () => {
    ;(client.getSkills as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}))

    render(<SkillsTab />)

    expect(screen.getByTestId('skills-loading')).toBeInTheDocument()
  })

  it('shows empty state when no skills', async () => {
    ;(client.getSkills as ReturnType<typeof vi.fn>).mockResolvedValue({
      skills: [],
    })

    render(<SkillsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('skills-empty-state')).toBeInTheDocument()
    })
  })

  it('displays skills list with correct data', async () => {
    ;(client.getSkills as ReturnType<typeof vi.fn>).mockResolvedValue({
      skills: [
        {
          skillId: 'skill-1',
          name: 'Web Search',
          description: 'Search the web for information',
          category: 'search',
          sensitivity: 'medium',
          enabled: true,
          source: 'builtin',
        },
        {
          skillId: 'skill-2',
          name: 'Code Execution',
          description: 'Execute code snippets',
          category: 'write',
          sensitivity: 'high',
          enabled: false,
          source: 'plugin',
        },
      ],
    })

    render(<SkillsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('skills-list')).toBeInTheDocument()
    })

    expect(screen.getByTestId('skill-card-0')).toBeInTheDocument()
    expect(screen.getByTestId('skill-card-1')).toBeInTheDocument()
    expect(screen.getByText('Web Search')).toBeInTheDocument()
    expect(screen.getByText('Code Execution')).toBeInTheDocument()
    expect(screen.getByText('ID: skill-1')).toBeInTheDocument()
    expect(screen.getByText('ID: skill-2')).toBeInTheDocument()
    expect(screen.getByText('search')).toBeInTheDocument()
    expect(screen.getByText('write')).toBeInTheDocument()
    expect(screen.getByText('Search the web for information')).toBeInTheDocument()
    expect(screen.getByText('Execute code snippets')).toBeInTheDocument()
  })

  it('shows enabled checkmark correctly', async () => {
    ;(client.getSkills as ReturnType<typeof vi.fn>).mockResolvedValue({
      skills: [
        {
          skillId: 'skill-1',
          name: 'Web Search',
          description: 'Search the web',
          category: 'search',
          sensitivity: 'medium',
          enabled: true,
          source: 'builtin',
        },
        {
          skillId: 'skill-2',
          name: 'Code Execution',
          description: 'Execute code',
          category: 'write',
          sensitivity: 'high',
          enabled: false,
          source: 'plugin',
        },
      ],
    })

    render(<SkillsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('skill-enabled-0')).toBeInTheDocument()
    })

    expect(screen.getByTestId('skill-enabled-0')).toHaveTextContent('✓ 已启用')
    expect(screen.getByText('✗ 已禁用')).toBeInTheDocument()
  })

  it('shows error state on API failure', async () => {
    ;(client.getSkills as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'))

    render(<SkillsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('skills-error')).toBeInTheDocument()
    })
  })
})
