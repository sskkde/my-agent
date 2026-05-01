import React, { useState, FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import './Auth.css';

interface LoginPageProps {
  mode: 'setup' | 'login';
}

const LoginPage: React.FC<LoginPageProps> = ({ mode }) => {
  const { login, setupUser } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError('用户名不能为空');
      return;
    }

    if (!password) {
      setError('密码不能为空');
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === 'setup') {
        await setupUser(username.trim(), password);
      } else {
        await login(username.trim(), password);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '操作失败，请重试';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = mode === 'setup' ? '初次设置' : '登录';
  const subtitle = mode === 'setup'
    ? '创建管理员账户以开始使用 Agent Platform'
    : '请输入您的凭据以继续';
  const submitButtonText = mode === 'setup' ? '创建账户' : '登录';
  const usernameTestId = mode === 'setup' ? 'setup-username' : 'login-username';
  const passwordTestId = mode === 'setup' ? 'setup-password' : 'login-password';
  const submitTestId = mode === 'setup' ? 'setup-submit' : 'login-submit';
  const errorTestId = mode === 'setup' ? 'setup-error' : 'login-error';

  return (
    <div className="auth-page" data-testid="login-page">
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1 className="auth-title" data-testid="auth-title">{title}</h1>
            <p className="auth-subtitle" data-testid="auth-subtitle">{subtitle}</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {error && (
              <div className="auth-error" data-testid={errorTestId}>
                {error}
              </div>
            )}

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
              <input
                id={passwordTestId}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="auth-input"
                placeholder="请输入密码"
                disabled={isSubmitting}
                data-testid={passwordTestId}
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              />
            </div>

            <button
              type="submit"
              className="auth-submit-button"
              disabled={isSubmitting}
              data-testid={submitTestId}
            >
              {isSubmitting ? '处理中...' : submitButtonText}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
