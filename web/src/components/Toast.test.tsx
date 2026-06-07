import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ToastProvider, { useToast } from './Toast'

const TestComponent: React.FC = () => {
  const { addToast, removeToast, toasts } = useToast()

  return (
    <div>
      <button onClick={() => addToast('success', '成功消息')} data-testid="add-success">
        Add Success
      </button>
      <button onClick={() => addToast('error', '错误消息')} data-testid="add-error">
        Add Error
      </button>
      <button onClick={() => addToast('warning', '警告消息')} data-testid="add-warning">
        Add Warning
      </button>
      <button onClick={() => addToast('info', '信息消息')} data-testid="add-info">
        Add Info
      </button>
      {toasts.length > 0 && (
        <button onClick={() => removeToast(toasts[0].id)} data-testid="remove-first">
          Remove First
        </button>
      )}
      <span data-testid="toast-count">{toasts.length}</span>
    </div>
  )
}

const renderWithProvider = () => {
  return render(
    <ToastProvider>
      <TestComponent />
    </ToastProvider>,
  )
}

describe('Toast', () => {
  it('renders toast container', () => {
    renderWithProvider()
    expect(screen.getByRole('region', { name: '通知' })).toBeInTheDocument()
  })

  it('adds and displays a success toast', async () => {
    renderWithProvider()

    fireEvent.click(screen.getByTestId('add-success'))

    await waitFor(() => {
      expect(screen.getByText('成功消息')).toBeInTheDocument()
    })

    const toast = screen.getByRole('alert')
    expect(toast).toHaveClass('toast--success')
  })

  it('adds and displays an error toast', async () => {
    renderWithProvider()

    fireEvent.click(screen.getByTestId('add-error'))

    await waitFor(() => {
      expect(screen.getByText('错误消息')).toBeInTheDocument()
    })

    const toast = screen.getByRole('alert')
    expect(toast).toHaveClass('toast--error')
  })

  it('adds and displays a warning toast', async () => {
    renderWithProvider()

    fireEvent.click(screen.getByTestId('add-warning'))

    await waitFor(() => {
      expect(screen.getByText('警告消息')).toBeInTheDocument()
    })

    const toast = screen.getByRole('alert')
    expect(toast).toHaveClass('toast--warning')
  })

  it('adds and displays an info toast', async () => {
    renderWithProvider()

    fireEvent.click(screen.getByTestId('add-info'))

    await waitFor(() => {
      expect(screen.getByText('信息消息')).toBeInTheDocument()
    })

    const toast = screen.getByRole('alert')
    expect(toast).toHaveClass('toast--info')
  })

  it('removes toast when close button is clicked', async () => {
    renderWithProvider()

    fireEvent.click(screen.getByTestId('add-success'))

    await waitFor(() => {
      expect(screen.getByText('成功消息')).toBeInTheDocument()
    })

    const closeButton = screen.getByLabelText('关闭通知')
    fireEvent.click(closeButton)

    await waitFor(() => {
      expect(screen.queryByText('成功消息')).not.toBeInTheDocument()
    })
  })

  it('allows manual removal via removeToast', async () => {
    renderWithProvider()

    fireEvent.click(screen.getByTestId('add-success'))

    await waitFor(() => {
      expect(screen.getByText('成功消息')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('remove-first'))

    await waitFor(() => {
      expect(screen.queryByText('成功消息')).not.toBeInTheDocument()
    })
  })

  it('tracks multiple toasts', async () => {
    renderWithProvider()

    fireEvent.click(screen.getByTestId('add-success'))
    fireEvent.click(screen.getByTestId('add-error'))

    await waitFor(() => {
      expect(screen.getByTestId('toast-count')).toHaveTextContent('2')
    })

    expect(screen.getByText('成功消息')).toBeInTheDocument()
    expect(screen.getByText('错误消息')).toBeInTheDocument()
  })

  it('throws error when useToast is used outside provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<TestComponent />)).toThrow('useToast must be used within a ToastProvider')

    consoleError.mockRestore()
  })

  it('displays correct icon for each toast type', async () => {
    renderWithProvider()

    fireEvent.click(screen.getByTestId('add-success'))
    await waitFor(() => {
      expect(screen.getByText('✓')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('add-error'))
    await waitFor(() => {
      expect(screen.getByText('✕')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('add-warning'))
    await waitFor(() => {
      expect(screen.getByText('⚠')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('add-info'))
    await waitFor(() => {
      expect(screen.getByText('ℹ')).toBeInTheDocument()
    })
  })
})
