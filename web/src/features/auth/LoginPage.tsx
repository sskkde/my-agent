import React, { useState, FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import ErrorMessage from '../../components/ErrorMessage'
import './Auth.css'

interface LoginPageProps {
  mode: 'setup' | 'login'
}

const LoginPage: React.FC<LoginPageProps> = ({ mode }) => {
  const { login, setupUser } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!username.trim()) {
      setError(new Error('用户名不能为空'))
      return
    }

    if (!password) {
      setError(new Error('密码不能为空'))
      return
    }

    setIsSubmitting(true)

    try {
      if (mode === 'setup') {
        await setupUser(username.trim(), password)
      } else {
        await login(username.trim(), password)
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('操作失败，请重试'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const title = mode === 'setup' ? '初次设置' : '登录'
  const subtitle = mode === 'setup' ? '创建管理员账户以开始使用 Agent Platform' : '请输入您的凭据以继续'
  const submitButtonText = mode === 'setup' ? '创建账户' : '登录'
  const usernameTestId = mode === 'setup' ? 'setup-username' : 'login-username'
  const passwordTestId = mode === 'setup' ? 'setup-password' : 'login-password'
  const submitTestId = mode === 'setup' ? 'setup-submit' : 'login-submit'
  const errorTestId = mode === 'setup' ? 'setup-error' : 'login-error'

  return (
    <div className="auth-page" data-testid="login-page">
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1 className="auth-title" data-testid="auth-title">
              {title}
            </h1>
            <p className="auth-subtitle" data-testid="auth-subtitle">
              {subtitle}
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {error && <ErrorMessage error={error} size="small" data-testid={errorTestId} />}

            <div className="auth-field">
              <label htmlFor={usernameTestId} className="auth-label">
                用户名
              </label>
              <input
                id={usernameTestId}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="auth-input"
                placeholder="请输入用户名"
                disabled={isSubmitting}
                data-testid={usernameTestId}
                autoComplete="username"
              />
            </div>

            <div className="auth-field">
              <label htmlFor={passwordTestId} className="auth-label">
                密码
              </label>
              <div className="auth-input-wrapper">
                <input
                  id={passwordTestId}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-input auth-input--with-action"
                  placeholder="请输入密码"
                  disabled={isSubmitting}
                  data-testid={passwordTestId}
                  autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  className="auth-input-action"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  title={showPassword ? '隐藏密码' : '显示密码'}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="18" height="18" aria-hidden="true">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width="18" height="18" aria-hidden="true">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button type="submit" className="auth-submit-button" disabled={isSubmitting} data-testid={submitTestId}>
              {isSubmitting ? '处理中...' : submitButtonText}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
