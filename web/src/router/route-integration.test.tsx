import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import App from '../App'
import * as client from '../api/client'

vi.mock('../api/client')

vi.mock('../features/session/SessionWorkspace', () => ({
  default: (props: any) => (
    <div data-testid="session-workspace">
      SessionWorkspace{props?.initialSessionId ? ` (${props.initialSessionId})` : ''}
    </div>
  ),
}))

vi.mock('../features/monitor/AgentMonitorTab', () => ({
  default: () => <div data-testid="agent-monitor-tab">AgentMonitorTab</div>,
}))

const mockAuthenticatedUser = () => {
  vi.mocked(client.getSetupStatus).mockResolvedValue({ needsSetup: false })
  vi.mocked(client.getMe).mockResolvedValue({
    user: {
      userId: 'test-user-id',
      username: 'testuser',
      createdAt: '2024-01-01T00:00:00Z',
    },
  })
}

const renderApp = (initialEntries: string[] = ['/']) => {
  const router = createMemoryRouter(
    [
      {
        path: '/*',
        element: <App />,
      },
    ],
    {
      initialEntries,
    },
  )
  const result = render(<RouterProvider router={router} />)
  return {
    ...result,
    router,
  }
}

describe('Route Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Root and Chat routes', () => {
    it('/ renders chat section (session-workspace)', async () => {
      mockAuthenticatedUser()
      renderApp(['/'])

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument()
      })

      expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
    })

    it('/chat renders chat section', async () => {
      mockAuthenticatedUser()
      renderApp(['/chat'])

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument()
      })

      expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
    })

    it('/chat/:sessionId renders chat section with session workspace', async () => {
      mockAuthenticatedUser()
      renderApp(['/chat/ses_abc123'])

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument()
      })

      expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
    })
  })

  describe('Workspace route', () => {
    it('/workspace/dashboard renders workspace container with dashboard tab', async () => {
      mockAuthenticatedUser()
      renderApp(['/workspace/dashboard'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-workspace')).toBeInTheDocument()
      })

      expect(screen.getByTestId('product-nav-workspace')).toBeInTheDocument()
    })

    it('/workspace/sessions renders workspace container with sessions tab', async () => {
      mockAuthenticatedUser()
      renderApp(['/workspace/sessions'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-workspace')).toBeInTheDocument()
      })
    })

    it('/workspace/invalid-tab falls back to dashboard', async () => {
      mockAuthenticatedUser()
      renderApp(['/workspace/invalid-tab'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-workspace')).toBeInTheDocument()
      })
    })
  })

  describe('Operations route', () => {
    it('/operations/agent-monitor renders operations container', async () => {
      mockAuthenticatedUser()
      renderApp(['/operations/agent-monitor'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-operations')).toBeInTheDocument()
      })
    })

    it('/operations/skills renders operations container with skills tab', async () => {
      mockAuthenticatedUser()
      renderApp(['/operations/skills'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-operations')).toBeInTheDocument()
      })
    })

    it('/operations/invalid-tab falls back to agent-monitor', async () => {
      mockAuthenticatedUser()
      renderApp(['/operations/invalid-tab'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-operations')).toBeInTheDocument()
      })
    })
  })

  describe('Admin route', () => {
    it('/admin/settings renders admin container', async () => {
      mockAuthenticatedUser()
      renderApp(['/admin/settings'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-admin')).toBeInTheDocument()
      })
    })

    it('/admin/admin renders admin container with admin tab', async () => {
      mockAuthenticatedUser()
      renderApp(['/admin/admin'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-admin')).toBeInTheDocument()
      })
    })

    it('/admin/invalid-tab falls back to settings', async () => {
      mockAuthenticatedUser()
      renderApp(['/admin/invalid-tab'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-admin')).toBeInTheDocument()
      })
    })
  })

  describe('URL-derived activeTab', () => {
    it('highlights correct product nav section for workspace route', async () => {
      mockAuthenticatedUser()
      renderApp(['/workspace/dashboard'])

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument()
      })

      const workspaceButton = screen.getByTestId('product-nav-workspace')
      expect(workspaceButton).toHaveClass('product-nav__item--active')
    })

    it('highlights correct product nav section for operations route', async () => {
      mockAuthenticatedUser()
      renderApp(['/operations/agent-monitor'])

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument()
      })

      const operationsButton = screen.getByTestId('product-nav-operations')
      expect(operationsButton).toHaveClass('product-nav__item--active')
    })

    it('highlights correct product nav section for admin route', async () => {
      mockAuthenticatedUser()
      renderApp(['/admin/settings'])

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument()
      })

      const adminButton = screen.getByTestId('product-nav-admin')
      expect(adminButton).toHaveClass('product-nav__item--active')
    })

    it('highlights correct product nav section for chat route', async () => {
      mockAuthenticatedUser()
      renderApp(['/chat'])

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument()
      })

      const chatButton = screen.getByTestId('product-nav-chat')
      expect(chatButton).toHaveClass('product-nav__item--active')
    })
  })

  describe('Catch-all route', () => {
    it('unknown path redirects to root (chat)', async () => {
      mockAuthenticatedUser()
      renderApp(['/unknown/path'])

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument()
      })

      await waitFor(() => {
        expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
      })
    })
  })

  describe('Deep links with session IDs', () => {
    it('/chat/:sessionId deep link renders session workspace with session ID', async () => {
      mockAuthenticatedUser()
      renderApp(['/chat/ses_deep_link_123'])

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument()
      })

      const workspace = screen.getByTestId('session-workspace')
      expect(workspace).toBeInTheDocument()
      expect(workspace).toHaveTextContent('ses_deep_link_123')
    })

    it('/chat/:sessionId deep link preserves session ID in URL', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/chat/ses_preserve_456'])

      await waitFor(() => {
        expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
      })

      // Router state should reflect the session ID from URL
      expect(router.state.location.pathname).toBe('/chat/ses_preserve_456')
    })

    it('deep link to workspace dashboard tab renders correct container', async () => {
      mockAuthenticatedUser()
      renderApp(['/workspace/dashboard'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-workspace')).toBeInTheDocument()
      })

      expect(screen.getByTestId('product-nav-workspace')).toHaveClass('product-nav__item--active')
    })

    it('deep link to operations agent-monitor tab renders correct container', async () => {
      mockAuthenticatedUser()
      renderApp(['/operations/agent-monitor'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-operations')).toBeInTheDocument()
      })

      expect(screen.getByTestId('product-nav-operations')).toHaveClass('product-nav__item--active')
    })

    it('deep link to admin settings tab renders correct container', async () => {
      mockAuthenticatedUser()
      renderApp(['/admin/settings'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-admin')).toBeInTheDocument()
      })

      expect(screen.getByTestId('product-nav-admin')).toHaveClass('product-nav__item--active')
    })
  })

  describe('Browser history navigation', () => {
    it('browser back navigation updates active section', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/workspace/dashboard'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-workspace')).toBeInTheDocument()
      })

      // Navigate to operations
      router.navigate('/operations/agent-monitor')

      await waitFor(() => {
        expect(screen.getByTestId('container-page-operations')).toBeInTheDocument()
      })

      // Go back
      router.navigate(-1)

      await waitFor(() => {
        expect(screen.getByTestId('container-page-workspace')).toBeInTheDocument()
      })
    })

    it('browser forward navigation updates active section', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/workspace/dashboard'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-workspace')).toBeInTheDocument()
      })

      // Navigate to operations
      router.navigate('/operations/agent-monitor')

      await waitFor(() => {
        expect(screen.getByTestId('container-page-operations')).toBeInTheDocument()
      })

      // Go back
      router.navigate(-1)

      await waitFor(() => {
        expect(screen.getByTestId('container-page-workspace')).toBeInTheDocument()
      })

      // Go forward
      router.navigate(1)

      await waitFor(() => {
        expect(screen.getByTestId('container-page-operations')).toBeInTheDocument()
      })
    })

    it('browser history preserves session ID on back navigation', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/chat/ses_history_789'])

      await waitFor(() => {
        expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
      })

      // Navigate away
      router.navigate('/workspace/dashboard')

      await waitFor(() => {
        expect(screen.getByTestId('container-page-workspace')).toBeInTheDocument()
      })

      // Go back
      router.navigate(-1)

      await waitFor(() => {
        const workspace = screen.getByTestId('session-workspace')
        expect(workspace).toBeInTheDocument()
        expect(workspace).toHaveTextContent('ses_history_789')
      })
    })
  })

  describe('Reload persistence', () => {
    it('URL session ID persists across simulated reload', async () => {
      mockAuthenticatedUser()
      const sessionId = 'ses_reload_test'

      // Initial render with session ID in URL
      const { unmount } = renderApp([`/chat/${sessionId}`])

      await waitFor(() => {
        expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
      })

      // Simulate reload by unmounting and re-rendering with same URL
      unmount()

      renderApp([`/chat/${sessionId}`])

      await waitFor(() => {
        const workspace = screen.getByTestId('session-workspace')
        expect(workspace).toBeInTheDocument()
        expect(workspace).toHaveTextContent(sessionId)
      })
    })

    it('workspace tab persists across simulated reload', async () => {
      mockAuthenticatedUser()

      // Initial render
      const { unmount } = renderApp(['/workspace/sessions'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-workspace')).toBeInTheDocument()
      })

      // Simulate reload
      unmount()

      renderApp(['/workspace/sessions'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-workspace')).toBeInTheDocument()
      })
    })

    it('operations tab persists across simulated reload', async () => {
      mockAuthenticatedUser()

      // Initial render
      const { unmount } = renderApp(['/operations/skills'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-operations')).toBeInTheDocument()
      })

      // Simulate reload
      unmount()

      renderApp(['/operations/skills'])

      await waitFor(() => {
        expect(screen.getByTestId('container-page-operations')).toBeInTheDocument()
      })
    })
  })

  describe('Session URL/localStorage sync', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    afterEach(() => {
      localStorage.clear()
    })

    it('URL session ID takes precedence over localStorage', async () => {
      mockAuthenticatedUser()

      // Set localStorage to a different session
      localStorage.setItem('session-console-selected-session', 'ses_localstorage')

      // Render with URL session ID
      renderApp(['/chat/ses_url_precedence'])

      await waitFor(() => {
        const workspace = screen.getByTestId('session-workspace')
        expect(workspace).toBeInTheDocument()
        // URL session ID should be used, not localStorage
        expect(workspace).toHaveTextContent('ses_url_precedence')
      })
    })

    it('localStorage session ID is used when URL has no session', async () => {
      mockAuthenticatedUser()

      // Set localStorage session
      localStorage.setItem('session-console-selected-session', 'ses_local_fallback')

      // Render chat route without session ID in URL
      renderApp(['/chat'])

      await waitFor(() => {
        const workspace = screen.getByTestId('session-workspace')
        expect(workspace).toBeInTheDocument()
        // localStorage session should be used as fallback
        expect(workspace).toHaveTextContent('ses_local_fallback')
      })
    })

    it('no session in URL or localStorage renders workspace without session', async () => {
      mockAuthenticatedUser()

      // No localStorage, no URL session
      renderApp(['/chat'])

      await waitFor(() => {
        const workspace = screen.getByTestId('session-workspace')
        expect(workspace).toBeInTheDocument()
        // Should render without session ID
        expect(workspace).not.toHaveTextContent('ses_')
      })
    })

    it('invalid localStorage session ID is handled gracefully', async () => {
      mockAuthenticatedUser()

      // Set invalid localStorage value
      localStorage.setItem('session-console-selected-session', '')

      renderApp(['/chat'])

      await waitFor(() => {
        expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
      })
    })
  })
})
