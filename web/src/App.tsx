import { useCallback, useEffect, useRef, Suspense, lazy } from 'react'
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import AgentShell from './layout/AgentShell'
import ChatPage from './features/session/chat/ChatPage'
import LoginPage from './features/auth/LoginPage'
import ProductionSetupChecklist from './features/setup/ProductionSetupChecklist'
import { AuthProvider, useAuth } from './context/AuthContext'
import { routeToNavigation, navigationToRoute } from './router/route-mapping'
import { ROUTES } from './router/route-constants'
import { resolveSessionId, safeReadLocalStorage } from './features/session/session-migration'
import { SELECTED_SESSION_KEY } from './features/session/session-constants'
import { readStoredTheme, applyDocumentTheme, type AppTheme } from './theme-storage'
import { SecondaryModalHostProvider, useSecondaryModalHost } from './features/settings/secondary-modal-host-contract'
import { isValidModalDestination, type ModalDestination } from './features/settings/modal-destination-registry'
import SecondaryModal from './features/settings/SecondaryModal'
import type { TabId } from './components/TabNav'
import './styles.css'
import './theme.css'

const SessionMapPage = lazy(() => import('./features/map/SessionMapPage'))

const APP_THEMES = new Set<AppTheme>(['default', 'warm-paper', 'dark'])

/** Location state key carrying the one-shot modal destination from a legacy deep link. */
export const LEGACY_MODAL_STATE_KEY = 'modalDestination' as const

/**
 * ChatRouteContent - Renders the Chat section for /, /chat, /chat/:sessionId routes.
 *
 * Integrates URL/localStorage precedence from Task 4:
 * - URL sessionId takes priority when valid
 * - localStorage is fallback when URL has no sessionId
 * - Uses resolveSessionId for safe precedence handling
 */
function ChatRouteContent() {
  const location = useLocation()
  const navState = routeToNavigation(location.pathname)
  const localStorageSessionId = safeReadLocalStorage(SELECTED_SESSION_KEY)
  const resolvedSessionId = resolveSessionId(navState.sessionId ?? null, localStorageSessionId)

  return <ChatPage initialSessionId={resolvedSessionId ?? undefined} />
}

/**
 * LegacyRouteRedirect - Redirects a legacy secondary route to Chat.
 *
 * workspace/operations/admin paths no longer render standalone pages:
 * - Valid tab id (per the modal destination registry) → redirect to Chat
 *   carrying a one-shot `modalDestination` location state consumed by
 *   `LegacyModalDestinationConsumer`.
 * - Invalid/unknown tab id → plain redirect to Chat, no modal state.
 *
 * The raw path segment is validated directly (NOT via validateTabOrFallback,
 * which would silently turn an invalid id into the section default and open
 * the wrong modal).
 */
function LegacyRouteRedirect() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const rawTabId = location.pathname.split('/').filter(Boolean)[1] ?? null
    if (rawTabId && isValidModalDestination(rawTabId)) {
      navigate(ROUTES.CHAT, { replace: true, state: { [LEGACY_MODAL_STATE_KEY]: rawTabId } })
    } else {
      navigate(ROUTES.CHAT, { replace: true })
    }
  }, [location.pathname, navigate])

  return null
}

/**
 * LegacyModalDestinationConsumer - One-shot modal opener for legacy deep links.
 *
 * Rendered under `SecondaryModalHostProvider`: reads the `modalDestination`
 * location state left by `LegacyRouteRedirect`, opens the modal at that
 * destination, then clears the state (replace) so refresh/back never re-open
 * it. A consumed-location guard additionally protects against re-entry within
 * the same history entry (e.g. React StrictMode double effects).
 */
function LegacyModalDestinationConsumer() {
  const { openModal } = useSecondaryModalHost()
  const location = useLocation()
  const navigate = useNavigate()
  const consumedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const destination = (location.state as Record<string, unknown> | null)?.[LEGACY_MODAL_STATE_KEY]
    if (typeof destination !== 'string' || !isValidModalDestination(destination)) {
      return
    }
    if (consumedKeyRef.current === location.key) {
      return
    }
    consumedKeyRef.current = location.key
    openModal(destination as ModalDestination)
    navigate(location.pathname, { replace: true, state: {} })
  }, [location, navigate, openModal])

  return null
}

/**
 * AppRoutes - Route-driven content rendering with compatibility adapter.
 *
 * URL is the primary source of truth for navigation state.
 * activeTab is derived from the URL via routeToNavigation().
 * handleTabChange is a compatibility adapter that navigates to the matching URL.
 */
function AppRoutes() {
  const { isAuthenticated, needsSetup, setupInProgress, loading, logout, user, completeSetup } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  // Derive activeTab from URL (primary source of truth)
  const navState = routeToNavigation(location.pathname)
  const activeTab = navState.tabId
  const selectedSessionId = resolveSessionId(
    navState.sessionId ?? null,
    safeReadLocalStorage(SELECTED_SESSION_KEY),
  )

  /**
   * Compatibility adapter: translates legacy tab-change calls to URL navigation.
   * - AgentShell product section clicks: handleProductSectionClick → onTabChange(defaultTab)
   * - AgentShell sidebar tab clicks: onTabChange(tabId)
   * - Container page secondary nav: onTabChange(tabId)
   * All result in navigation to the corresponding URL.
   */
  const handleTabChange = useCallback(
    (tab: TabId) => {
      const route = navigationToRoute(tab)
      navigate(route)
    },
    [navigate],
  )

  if (loading) {
    return (
      <div className="auth-page" data-testid="auth-loading">
        <div className="auth-container">
          <div className="auth-card">
            <div className="auth-header">
              <h1 className="auth-title">加载中...</h1>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (needsSetup || setupInProgress) {
    return <ProductionSetupChecklist onComplete={completeSetup} />
  }

  if (!isAuthenticated) {
    return <LoginPage mode="login" />
  }

  return (
    // SecondaryModalHostProvider owns the modal destination state at App level
    // and carries the resolved Chat sessionId into modal feature props.
    // The modal dialog itself is rendered via a portal to document.body by the
    // secondary modal shell task.
    <SecondaryModalHostProvider sessionId={selectedSessionId}>
      <LegacyModalDestinationConsumer />
      <AgentShell
        activeTab={activeTab}
        onTabChange={handleTabChange}
        user={user}
        onLogout={logout}
        sessionId={selectedSessionId}
      >
        <Suspense fallback={<div className="center-stage-loading" data-testid="route-loading" />}>
          <Routes>
            {/* Root → renders Chat section (same as /chat) */}
            <Route path="/" element={<ChatRouteContent />} />

            {/* Chat section routes */}
            <Route path="/chat" element={<ChatRouteContent />} />
            <Route path="/chat/:sessionId" element={<ChatRouteContent />} />

            {/* Legacy secondary routes: redirected to Chat, opening the modal */}
            <Route path="/workspace/:tabId" element={<LegacyRouteRedirect />} />
            <Route path="/operations/:tabId" element={<LegacyRouteRedirect />} />
            <Route path="/admin/:tabId" element={<LegacyRouteRedirect />} />

            {/* AMap standalone route */}
            <Route path="/map/:sessionId" element={<SessionMapPage />} />

            {/* Catch-all: redirect to root (renders Chat) */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AgentShell>
      <SecondaryModal />
    </SecondaryModalHostProvider>
  )
}

function App() {
  useEffect(() => {
    applyDocumentTheme(readStoredTheme())

    const handleThemeChange = (event: Event) => {
      const selectedTheme = (event as CustomEvent<AppTheme>).detail
      if (APP_THEMES.has(selectedTheme)) {
        applyDocumentTheme(selectedTheme)
      }
    }

    window.addEventListener('agent-platform-theme-change', handleThemeChange)
    return () => window.removeEventListener('agent-platform-theme-change', handleThemeChange)
  }, [])

  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}

export default App
