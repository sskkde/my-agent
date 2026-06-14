import React from 'react'

interface ErrorWithCode {
  code: string
  message: string
}

function hasErrorCode(error: unknown): error is ErrorWithCode {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as ErrorWithCode).code === 'string' &&
    'message' in error &&
    typeof (error as ErrorWithCode).message === 'string'
  )
}

/**
 * Maps API error codes to user-friendly Chinese messages.
 * Returns title and description for the error.
 */
export function getErrorDisplay(error: Error | null | undefined): {
  title: string
  description: string
} {
  if (!error) {
    return {
      title: '发生错误',
      description: '请稍后再试',
    }
  }

  if (hasErrorCode(error)) {
    const code = error.code

    switch (code) {
      case '401':
      case 'UNAUTHORIZED':
      case 'AUTH_FAILED':
        return {
          title: '认证失败',
          description: '请重新登录',
        }
      case '403':
      case 'FORBIDDEN':
      case 'ACCESS_DENIED':
        return {
          title: '没有权限',
          description: '没有权限执行此操作',
        }
      case '429':
      case 'RATE_LIMITED':
      case 'TOO_MANY_REQUESTS':
        return {
          title: '请求过于频繁',
          description: '请稍后再试',
        }
      case '500':
      case 'INTERNAL_ERROR':
      case 'SERVER_ERROR':
        return {
          title: '服务器错误',
          description: '服务器内部错误，请稍后再试',
        }
      case '404':
      case 'NOT_FOUND':
        return {
          title: '资源不存在',
          description: '请求的资源未找到',
        }
      case '400':
      case 'BAD_REQUEST':
      case 'VALIDATION_ERROR':
        return {
          title: '请求无效',
          description: error.message || '请检查输入后重试',
        }
      case 'NETWORK_ERROR':
      case 'CONNECTION_FAILED':
        return {
          title: '网络错误',
          description: '无法连接到服务器，请检查网络连接',
        }
      default:
        return {
          title: '操作失败',
          description: error.message || '请稍后再试',
        }
    }
  }

  return {
    title: '发生错误',
    description: error.message || '请稍后再试',
  }
}

export interface ErrorMessageProps extends React.HTMLAttributes<HTMLDivElement> {
  error: Error | null | undefined
  title?: string
  description?: string
  retry?: {
    label?: string
    onClick: () => void
    testId?: string
  }
  className?: string
  size?: 'small' | 'medium' | 'large'
  variant?: 'default' | 'inline' | 'card'
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({
  error,
  title,
  description,
  retry,
  className = '',
  size = 'medium',
  variant = 'default',
  ...restProps
}) => {
  const errorDisplay = getErrorDisplay(error)
  const displayTitle = title ?? errorDisplay.title
  const displayDescription = description ?? errorDisplay.description

  const sizeClass = `error-message--${size}`
  const variantClass = `error-message--${variant}`
  const combinedClassName = `error-message ${sizeClass} ${variantClass} ${className}`.trim()

  const dataTestId = 'data-testid' in restProps ? restProps['data-testid'] : 'error-message'

  return (
    <div
      className={combinedClassName}
      role="alert"
      data-testid={dataTestId}
      {...restProps}
    >
      <div className="error-message__icon" aria-hidden="true">
        ⚠
      </div>
      <div className="error-message__content">
        <h4 className="error-message__title">{displayTitle}</h4>
        <p className="error-message__description">{displayDescription}</p>
      </div>
      {retry && (
        <button
          className="error-message__retry"
          onClick={retry.onClick}
          type="button"
          data-testid={retry.testId || 'error-message-retry'}
        >
          {retry.label || '重试'}
        </button>
      )}
    </div>
  )
}

export default ErrorMessage
