import { useCallback, useEffect, Suspense, lazy } from 'react'
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import AgentShell from './layout/AgentShell'
import SessionWorkspace from './features/session/SessionWorkspace'
import LoginPage from './features/auth/LoginPage'
import ProductionSetupChecklist from './features/setup/ProductionSetupChecklist'
import { AuthProvider, useAuth } from './context/AuthContext'
import { routeToNavigation, navigationToRoute } from './router/route-mapping'
import { resolveSessionId, safeReadLocalStorage } from './features/session/session-migration'
import { SELECTED_SESSION_KEY } from './features/session/session-constants'
import { readStoredTheme, applyDocumentTheme, type AppTheme } from './theme-storage'
import type { TabId } from './components/TabNav'
import './styles.css'
import './theme.css'

const WorkspacePage = lazy(() => import('./features/workspace/WorkspacePage'))
const OperationsPage = lazy(() => import('./features/operations/OperationsPage'))
const AdminPage = lazy(() => import('./features/admin/AdminPage'))

const APP_THEMES = new Set<AppTheme>(['default', 'warm-paper', 'dark'])

/**
 * ChatRouteContent - Renders the Chat section for /, /chat, /chat/:sessionId routes.
 *
 * Integrates URL/localStorage precedence from Task 4:
 * - URL sessionId takes priority when valid
 * - localStorage is fallback when URL has no sessionId
 * - Uses resolveSessionId for safe precedence handling
 */
function ChatRouteContent({ onTabChange }: { onTabChange: (tab: TabId) => void }) {
  const location = useLocation()
  const navState = routeToNavigation(location.pathname)
  const localStorageSessionId = safeReadLocalStorage(SELECTED_SESSION_KEY)
  const resolvedSessionId = resolveSessionId(navState.sessionId ?? null, localStorageSessionId)

  return (
    <SessionWorkspace
      initialSessionId={resolvedSessionId ?? undefined}
      onTabChange={onTabChange}
    />
  )
}

/**
 * WorkspaceRouteContent - Renders WorkspacePage with tab derived from URL.
 *
 * Integrates URL/localStorage precedence for sessionId:
 * - URL sessionId takes priority when valid
 * - localStorage is fallback when URL has no sessionId
 * - Uses resolveSessionId for safe precedence handling
 */
function WorkspaceRouteContent({ onTabChange }: { onTabChange: (tab: TabId) => void }) {
  const location = useLocation()
  const navState = routeToNavigation(location.pathname)
  const localStorageSessionId = safeReadLocalStorage(SELECTED_SESSION_KEY)
  const resolvedSessionId = resolveSessionId(navState.sessionId ?? null, localStorageSessionId)

  return <WorkspacePage activeTab={navState.tabId} onTabChange={onTabChange} sessionId={resolvedSessionId} />
}

/**
 * OperationsRouteContent - Renders OperationsPage with tab derived from URL.
 */
function OperationsRouteContent({ onTabChange }: { onTabChange: (tab: TabId) => void }) {
  const location = useLocation()
  const navState = routeToNavigation(location.pathname)
  return <OperationsPage activeTab={navState.tabId} onTabChange={onTabChange} />
}

/**
 * AdminRouteContent - Renders AdminPage with tab derived from URL.
 */
function AdminRouteContent({ onTabChange }: { onTabChange: (tab: TabId) => void }) {
  const location = useLocation()
  const navState = routeToNavigation(location.pathname)
  return <AdminPage activeTab={navState.tabId} onTabChange={onTabChange} />
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
          <Route path="/" element={<ChatRouteContent onTabChange={handleTabChange} />} />

          {/* Chat section routes */}
          <Route path="/chat" element={<ChatRouteContent onTabChange={handleTabChange} />} />
          <Route path="/chat/:sessionId" element={<ChatRouteContent onTabChange={handleTabChange} />} />

          {/* Workspace section route with tab parameter */}
          <Route path="/workspace/:tabId" element={<WorkspaceRouteContent onTabChange={handleTabChange} />} />

          {/* Operations section route with tab parameter */}
          <Route path="/operations/:tabId" element={<OperationsRouteContent onTabChange={handleTabChange} />} />

          {/* Admin section route with tab parameter */}
          <Route path="/admin/:tabId" element={<AdminRouteContent onTabChange={handleTabChange} />} />

          {/* Catch-all: redirect to root (renders Chat) */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AgentShell>
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
