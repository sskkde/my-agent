import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import App from '../App'
import * as client from '../api/client'

vi.mock('../api/client')

vi.mock('../features/session/chat/ChatPage', () => ({
  default: (props: any) => (
    <div data-testid="session-workspace">
      ChatPage{props?.initialSessionId ? ` (${props.initialSessionId})` : ''}
    </div>
  ),
}))

vi.mock('../features/map/SessionMapPage', () => ({
  default: ({ sessionId }: { sessionId?: string }) => (
    <div data-testid="session-map-page">
      SessionMapPage{sessionId ? ` (${sessionId})` : ''}
    </div>
  ),
}))

// SecondaryModal is a portal + focus-management shell; the route-integration
// suite only needs to observe WHICH destination the host opened, so it is
// replaced by a lightweight probe reading the same host contract.
vi.mock('../features/settings/SecondaryModal', async () => {
  const contract = await vi.importActual<
    typeof import('../features/settings/secondary-modal-host-contract')
  >('../features/settings/secondary-modal-host-contract')
  return {
    default: () => {
      const { destination } = contract.useSecondaryModalHost()
      return destination ? <div data-testid="secondary-modal-open">{destination}</div> : null
    },
  }
})

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

const mockUnauthenticatedUser = () => {
  vi.mocked(client.getSetupStatus).mockResolvedValue({ needsSetup: false })
  vi.mocked(client.getMe).mockRejectedValue(
    Object.assign(new Error('Unauthorized'), { status: 401 }),
  )
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

const openModalProbe = () => screen.getByTestId('secondary-modal-open')

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

  describe('Legacy secondary route redirects', () => {
    it('/workspace/dashboard redirects to /chat and opens modal at dashboard', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/workspace/dashboard'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('dashboard')
      })

      expect(router.state.location.pathname).toBe('/chat')
      expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
    })

    it('/workspace/sessions redirects and opens modal at sessions', async () => {
      mockAuthenticatedUser()
      renderApp(['/workspace/sessions'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('sessions')
      })

      expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
    })

    it('/operations/agent-monitor redirects and opens modal at agent-monitor', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/operations/agent-monitor'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('agent-monitor')
      })

      expect(router.state.location.pathname).toBe('/chat')
    })

    it('/admin/settings redirects and opens modal at settings (SettingsTab)', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/admin/settings'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('settings')
      })

      expect(router.state.location.pathname).toBe('/chat')
    })

    it('/admin/admin redirects and opens modal at admin', async () => {
      mockAuthenticatedUser()
      renderApp(['/admin/admin'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('admin')
      })
    })

    it('/workspace/not-real redirects to /chat without opening a modal', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/workspace/not-real'])

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/chat')
      })
      await waitFor(() => {
        expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('secondary-modal-open')).not.toBeInTheDocument()
    })

    it('/operations/invalid-tab redirects without modal state', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/operations/invalid-tab'])

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/chat')
      })

      expect(screen.queryByTestId('secondary-modal-open')).not.toBeInTheDocument()
    })

    it('modal destination state is consumed once and cleared from the location', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/workspace/dashboard'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('dashboard')
      })

      expect(router.state.location.state).toEqual({})
    })

    it('reloading the redirect target does not re-open the modal', async () => {
      mockAuthenticatedUser()
      const { unmount } = renderApp(['/workspace/dashboard'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('dashboard')
      })

      unmount()

      // Simulate a refresh of the redirected /chat URL: the one-shot state was
      // cleared during consumption, so no modal destination is re-injected.
      renderApp(['/chat'])

      await waitFor(() => {
        expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('secondary-modal-open')).not.toBeInTheDocument()
    })

    it('back navigation after consumption does not re-open the modal', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/chat', '/workspace/dashboard'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('dashboard')
      })
      expect(router.state.location.pathname).toBe('/chat')

      router.navigate(-1)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/chat')
      })

      // The previous entry has no modalDestination state; navigating back must
      // not re-trigger the one-shot opener.
      expect(router.state.location.state?.modalDestination).toBeUndefined()
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

  describe('Map route /map/:sessionId', () => {
    it('authenticated /map/:sessionId renders session map page', async () => {
      mockAuthenticatedUser()
      renderApp(['/map/ses_map_123'])

      await waitFor(() => {
        expect(screen.getByTestId('session-map-page')).toBeInTheDocument()
      })
    })

    it('authenticated /map/:sessionId does not redirect to root', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/map/ses_map_123'])

      await waitFor(() => {
        expect(screen.getByTestId('session-map-page')).toBeInTheDocument()
      })

      expect(router.state.location.pathname).toBe('/map/ses_map_123')
      expect(screen.queryByTestId('session-workspace')).not.toBeInTheDocument()
    })

    it('unauthenticated /map/:sessionId shows login page (auth-gated)', async () => {
      mockUnauthenticatedUser()
      renderApp(['/map/ses_map_123'])

      await waitFor(() => {
        expect(screen.getByTestId('login-page')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('session-map-page')).not.toBeInTheDocument()
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

      expect(router.state.location.pathname).toBe('/chat/ses_preserve_456')
    })

    it('legacy workspace dashboard deep link lands on chat with modal open', async () => {
      mockAuthenticatedUser()
      renderApp(['/workspace/dashboard'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('dashboard')
      })

      expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
    })

    it('legacy operations agent-monitor deep link lands on chat with modal open', async () => {
      mockAuthenticatedUser()
      renderApp(['/operations/agent-monitor'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('agent-monitor')
      })

      expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
    })

    it('legacy admin settings deep link lands on chat with modal open', async () => {
      mockAuthenticatedUser()
      renderApp(['/admin/settings'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('settings')
      })

      expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
    })
  })

  describe('Browser history navigation', () => {
    it('back navigation from a legacy deep link returns to the previous chat entry', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/chat/ses_history_789', '/workspace/dashboard'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('dashboard')
      })
      expect(router.state.location.pathname).toBe('/chat')

      router.navigate(-1)

      await waitFor(() => {
        const workspace = screen.getByTestId('session-workspace')
        expect(workspace).toHaveTextContent('ses_history_789')
      })

      expect(router.state.location.pathname).toBe('/chat/ses_history_789')
    })

    it('forward navigation back to the legacy redirect does not re-open the modal', async () => {
      mockAuthenticatedUser()
      const { router } = renderApp(['/chat/ses_history_789', '/workspace/dashboard'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('dashboard')
      })

      router.navigate(-1)
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/chat/ses_history_789')
      })

      router.navigate(1)
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/chat')
      })

      // Forward returns to the redirected entry whose state was cleared during
      // one-shot consumption; no destination is re-injected on arrival.
      expect(router.state.location.state?.modalDestination).toBeUndefined()
    })
  })

  describe('Reload persistence', () => {
    it('URL session ID persists across simulated reload', async () => {
      mockAuthenticatedUser()
      const sessionId = 'ses_reload_test'

      const { unmount } = renderApp([`/chat/${sessionId}`])

      await waitFor(() => {
        expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
      })

      unmount()

      renderApp([`/chat/${sessionId}`])

      await waitFor(() => {
        const workspace = screen.getByTestId('session-workspace')
        expect(workspace).toBeInTheDocument()
        expect(workspace).toHaveTextContent(sessionId)
      })
    })

    it('legacy workspace deep link re-opens the modal on re-entry', async () => {
      mockAuthenticatedUser()

      const { unmount } = renderApp(['/workspace/sessions'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('sessions')
      })

      unmount()

      // Re-entering the legacy URL performs the redirect + one-shot open again.
      renderApp(['/workspace/sessions'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('sessions')
      })
    })

    it('legacy operations deep link re-opens the modal on re-entry', async () => {
      mockAuthenticatedUser()

      const { unmount } = renderApp(['/operations/skills'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('skills')
      })

      unmount()

      renderApp(['/operations/skills'])

      await waitFor(() => {
        expect(openModalProbe()).toHaveTextContent('skills')
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

      localStorage.setItem('session-console-selected-session', 'ses_localstorage')

      renderApp(['/chat/ses_url_precedence'])

      await waitFor(() => {
        const workspace = screen.getByTestId('session-workspace')
        expect(workspace).toBeInTheDocument()
        expect(workspace).toHaveTextContent('ses_url_precedence')
      })
    })

    it('localStorage session ID is used when URL has no session', async () => {
      mockAuthenticatedUser()

      localStorage.setItem('session-console-selected-session', 'ses_local_fallback')

      renderApp(['/chat'])

      await waitFor(() => {
        const workspace = screen.getByTestId('session-workspace')
        expect(workspace).toBeInTheDocument()
        expect(workspace).toHaveTextContent('ses_local_fallback')
      })
    })

    it('no session in URL or localStorage renders workspace without session', async () => {
      mockAuthenticatedUser()

      renderApp(['/chat'])

      await waitFor(() => {
        const workspace = screen.getByTestId('session-workspace')
        expect(workspace).toBeInTheDocument()
        expect(workspace).not.toHaveTextContent('ses_')
      })
    })

    it('invalid localStorage session ID is handled gracefully', async () => {
      mockAuthenticatedUser()

      localStorage.setItem('session-console-selected-session', '')

      renderApp(['/chat'])

      await waitFor(() => {
        expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
      })
    })
  })
})
