import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getSetupStatus, getMe, setupUser, login, logout } from '../api/client'
import type { UserMetadata } from '../api/types'

interface AuthState {
  needsSetup: boolean
  isAuthenticated: boolean
  user: UserMetadata | null
  loading: boolean
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<void>
  setupUser: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkAuthStatus: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    needsSetup: false,
    isAuthenticated: false,
    user: null,
    loading: true,
  })

  const checkAuthStatus = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }))
    try {
      const setupStatus = await getSetupStatus()

      if (setupStatus.needsSetup) {
        setState({
          needsSetup: true,
          isAuthenticated: false,
          user: null,
          loading: false,
        })
        return
      }

      try {
        const userData = await getMe()
        setState({
          needsSetup: false,
          isAuthenticated: true,
          user: userData.user,
          loading: false,
        })
      } catch {
        setState({
          needsSetup: false,
          isAuthenticated: false,
          user: null,
          loading: false,
        })
      }
    } catch {
      setState({
        needsSetup: false,
        isAuthenticated: false,
        user: null,
        loading: false,
      })
    }
  }, [])

  const handleLogin = useCallback(async (username: string, password: string) => {
    const result = await login(username, password)
    setState({
      needsSetup: false,
      isAuthenticated: true,
      user: result.user,
      loading: false,
    })
  }, [])

  const handleSetupUser = useCallback(async (username: string, password: string) => {
    const result = await setupUser(username, password)
    setState({
      needsSetup: false,
      isAuthenticated: true,
      user: result.user,
      loading: false,
    })
  }, [])

  const handleLogout = useCallback(async () => {
    await logout()
    setState({
      needsSetup: false,
      isAuthenticated: false,
      user: null,
      loading: false,
    })
  }, [])

  useEffect(() => {
    checkAuthStatus()
  }, [checkAuthStatus])

  const value: AuthContextType = {
    ...state,
    login: handleLogin,
    setupUser: handleSetupUser,
    logout: handleLogout,
    checkAuthStatus,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export default AuthContext
