import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ErrorMessage, { getErrorDisplay } from './ErrorMessage'

describe('ErrorMessage', () => {
  describe('getErrorDisplay', () => {
    it('returns default title/description for null error', () => {
      const result = getErrorDisplay(null)
      expect(result).toEqual({
        title: '发生错误',
        description: '请稍后再试',
      })
    })

    it('returns default title/description for undefined error', () => {
      const result = getErrorDisplay(undefined)
      expect(result).toEqual({
        title: '发生错误',
        description: '请稍后再试',
      })
    })

    it('maps 401 error code to unauthorized message', () => {
      const error = { code: '401', message: 'Unauthorized' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('认证失败')
      expect(result.description).toBe('请重新登录')
    })

    it('maps UNAUTHORIZED error code to unauthorized message', () => {
      const error = { code: 'UNAUTHORIZED', message: 'Not authorized' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('认证失败')
      expect(result.description).toBe('请重新登录')
    })

    it('maps AUTH_FAILED error code to unauthorized message', () => {
      const error = { code: 'AUTH_FAILED', message: 'Auth failed' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('认证失败')
      expect(result.description).toBe('请重新登录')
    })

    it('maps 403 error code to forbidden message', () => {
      const error = { code: '403', message: 'Forbidden' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('没有权限')
      expect(result.description).toBe('没有权限执行此操作')
    })

    it('maps FORBIDDEN error code to forbidden message', () => {
      const error = { code: 'FORBIDDEN', message: 'Access denied' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('没有权限')
      expect(result.description).toBe('没有权限执行此操作')
    })

    it('maps ACCESS_DENIED error code to forbidden message', () => {
      const error = { code: 'ACCESS_DENIED', message: 'No access' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('没有权限')
      expect(result.description).toBe('没有权限执行此操作')
    })

    it('maps 500 error code to server error message', () => {
      const error = { code: '500', message: 'Internal Server Error' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('服务器错误')
      expect(result.description).toBe('服务器内部错误，请稍后再试')
    })

    it('maps INTERNAL_ERROR error code to server error message', () => {
      const error = { code: 'INTERNAL_ERROR', message: 'Internal error' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('服务器错误')
      expect(result.description).toBe('服务器内部错误，请稍后再试')
    })

    it('maps SERVER_ERROR error code to server error message', () => {
      const error = { code: 'SERVER_ERROR', message: 'Server error' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('服务器错误')
      expect(result.description).toBe('服务器内部错误，请稍后再试')
    })

    it('maps NETWORK_ERROR error code to network error message', () => {
      const error = { code: 'NETWORK_ERROR', message: 'Connection failed' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('网络错误')
      expect(result.description).toBe('无法连接到服务器，请检查网络连接')
    })

    it('maps CONNECTION_FAILED error code to network error message', () => {
      const error = { code: 'CONNECTION_FAILED', message: 'No connection' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('网络错误')
      expect(result.description).toBe('无法连接到服务器，请检查网络连接')
    })

    it('maps 429 error code to rate limited message', () => {
      const error = { code: '429', message: 'Too Many Requests' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('请求过于频繁')
      expect(result.description).toBe('请稍后再试')
    })

    it('maps RATE_LIMITED error code to rate limited message', () => {
      const error = { code: 'RATE_LIMITED', message: 'Rate limited' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('请求过于频繁')
      expect(result.description).toBe('请稍后再试')
    })

    it('maps 404 error code to not found message', () => {
      const error = { code: '404', message: 'Not Found' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('资源不存在')
      expect(result.description).toBe('请求的资源未找到')
    })

    it('maps NOT_FOUND error code to not found message', () => {
      const error = { code: 'NOT_FOUND', message: 'Resource not found' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('资源不存在')
      expect(result.description).toBe('请求的资源未找到')
    })

    it('maps 400 error code to bad request message', () => {
      const error = { code: '400', message: 'Invalid input' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('请求无效')
      expect(result.description).toBe('Invalid input')
    })

    it('maps BAD_REQUEST error code to bad request message', () => {
      const error = { code: 'BAD_REQUEST', message: 'Bad data' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('请求无效')
      expect(result.description).toBe('Bad data')
    })

    it('maps VALIDATION_ERROR error code to bad request message', () => {
      const error = { code: 'VALIDATION_ERROR', message: 'Validation failed' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('请求无效')
      expect(result.description).toBe('Validation failed')
    })

    it('maps unknown error code to default message with error message', () => {
      const error = { code: 'UNKNOWN', message: 'Something went wrong' } as Error & { code: string }
      const result = getErrorDisplay(error)
      expect(result.title).toBe('操作失败')
      expect(result.description).toBe('Something went wrong')
    })

    it('returns error message for error without code', () => {
      const error = new Error('Something failed')
      const result = getErrorDisplay(error)
      expect(result.title).toBe('发生错误')
      expect(result.description).toBe('Something failed')
    })

    it('returns default description for error without message', () => {
      const error = new Error()
      const result = getErrorDisplay(error)
      expect(result.title).toBe('发生错误')
      expect(result.description).toBe('请稍后再试')
    })
  })

  describe('rendering', () => {
    it('renders with error prop', () => {
      const error = { code: '500', message: 'Server error' } as Error & { code: string }
      render(<ErrorMessage error={error} />)

      expect(screen.getByTestId('error-message')).toBeInTheDocument()
      expect(screen.getByText('服务器错误')).toBeInTheDocument()
      expect(screen.getByText('服务器内部错误，请稍后再试')).toBeInTheDocument()
    })

    it('renders with custom title override', () => {
      const error = { code: '500', message: 'Server error' } as Error & { code: string }
      render(<ErrorMessage error={error} title="自定义标题" />)

      expect(screen.getByText('自定义标题')).toBeInTheDocument()
      expect(screen.queryByText('服务器错误')).not.toBeInTheDocument()
    })

    it('renders with custom description override', () => {
      const error = { code: '500', message: 'Server error' } as Error & { code: string }
      render(<ErrorMessage error={error} description="自定义描述" />)

      expect(screen.getByText('自定义描述')).toBeInTheDocument()
      expect(screen.queryByText('服务器内部错误，请稍后再试')).not.toBeInTheDocument()
    })

    it('renders with retry button', () => {
      const handleRetry = vi.fn()
      const error = { code: 'NETWORK_ERROR', message: 'Connection failed' } as Error & { code: string }
      render(<ErrorMessage error={error} retry={{ onClick: handleRetry }} />)

      const retryButton = screen.getByTestId('error-message-retry')
      expect(retryButton).toBeInTheDocument()
      expect(retryButton).toHaveTextContent('重试')
    })

    it('renders with custom retry label', () => {
      const handleRetry = vi.fn()
      const error = { code: 'NETWORK_ERROR', message: 'Connection failed' } as Error & { code: string }
      render(<ErrorMessage error={error} retry={{ label: '重新加载', onClick: handleRetry }} />)

      const retryButton = screen.getByTestId('error-message-retry')
      expect(retryButton).toHaveTextContent('重新加载')
    })

    it('calls retry onClick when retry button is clicked', () => {
      const handleRetry = vi.fn()
      const error = { code: 'NETWORK_ERROR', message: 'Connection failed' } as Error & { code: string }
      render(<ErrorMessage error={error} retry={{ onClick: handleRetry }} />)

      fireEvent.click(screen.getByTestId('error-message-retry'))

      expect(handleRetry).toHaveBeenCalledTimes(1)
    })

    it('renders with small size', () => {
      const error = { code: '500', message: 'Error' } as Error & { code: string }
      render(<ErrorMessage error={error} size="small" />)

      const errorMessage = screen.getByTestId('error-message')
      expect(errorMessage).toHaveClass('error-message--small')
    })

    it('renders with medium size', () => {
      const error = { code: '500', message: 'Error' } as Error & { code: string }
      render(<ErrorMessage error={error} size="medium" />)

      const errorMessage = screen.getByTestId('error-message')
      expect(errorMessage).toHaveClass('error-message--medium')
    })

    it('renders with large size', () => {
      const error = { code: '500', message: 'Error' } as Error & { code: string }
      render(<ErrorMessage error={error} size="large" />)

      const errorMessage = screen.getByTestId('error-message')
      expect(errorMessage).toHaveClass('error-message--large')
    })

    it('renders with inline variant', () => {
      const error = { code: '500', message: 'Error' } as Error & { code: string }
      render(<ErrorMessage error={error} variant="inline" />)

      const errorMessage = screen.getByTestId('error-message')
      expect(errorMessage).toHaveClass('error-message--inline')
    })

    it('renders with card variant', () => {
      const error = { code: '500', message: 'Error' } as Error & { code: string }
      render(<ErrorMessage error={error} variant="card" />)

      const errorMessage = screen.getByTestId('error-message')
      expect(errorMessage).toHaveClass('error-message--card')
    })

    it('renders with custom className', () => {
      const error = { code: '500', message: 'Error' } as Error & { code: string }
      render(<ErrorMessage error={error} className="custom-class" />)

      const errorMessage = screen.getByTestId('error-message')
      expect(errorMessage).toHaveClass('custom-class')
    })

    it('has accessibility role alert', () => {
      const error = { code: '500', message: 'Error' } as Error & { code: string }
      render(<ErrorMessage error={error} />)

      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('renders error icon', () => {
      const error = { code: '500', message: 'Error' } as Error & { code: string }
      render(<ErrorMessage error={error} />)

      const icon = document.querySelector('.error-message__icon')
      expect(icon).toBeInTheDocument()
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveTextContent('⚠')
    })

    it('does not render retry button when retry prop is not provided', () => {
      const error = { code: '500', message: 'Error' } as Error & { code: string }
      render(<ErrorMessage error={error} />)

      expect(screen.queryByTestId('error-message-retry')).not.toBeInTheDocument()
    })

    it('renders with custom data-testid', () => {
      const error = { code: '500', message: 'Error' } as Error & { code: string }
      render(<ErrorMessage error={error} data-testid="custom-error" />)

      expect(screen.getByTestId('custom-error')).toBeInTheDocument()
    })

    it('preserves default data-testid when custom value is not provided', () => {
      const error = { code: '500', message: 'Error' } as Error & { code: string }
      render(<ErrorMessage error={error} />)

      expect(screen.getByTestId('error-message')).toBeInTheDocument()
    })
  })
})
