import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ProductionSetupChecklist from './ProductionSetupChecklist'
import * as adminApi from '../../api/admin'
import * as client from '../../api/client'
import { AuthProvider } from '../../context/AuthContext'

vi.mock('../../api/admin')
vi.mock('../../api/client')

const mockSetupUser = vi.fn()
vi.mocked(client.setupUser).mockImplementation(mockSetupUser)

const renderWithAuth = (component: React.ReactNode) => {
  return render(<AuthProvider>{component}</AuthProvider>)
}

describe('ProductionSetupChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(client.getSetupStatus).mockResolvedValue({ needsSetup: true })
    mockSetupUser.mockResolvedValue({
      user: {
        userId: 'test-user-id',
        username: 'admin',
        createdAt: '2024-01-01T00:00:00Z',
      },
    })
    vi.mocked(adminApi.createApiKey).mockResolvedValue({
      id: 'key-id',
      name: 'Test Key',
      key: 'ak_test123456789',
      prefix: 'ak_test',
      role: 'admin',
      createdAt: '2024-01-01T00:00:00Z',
    })
    vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({
      connectors: [],
    })
  })

  it('renders step 1 - admin user creation', async () => {
    renderWithAuth(<ProductionSetupChecklist />)
    await waitFor(() => {
      expect(screen.getByTestId('production-setup-page')).toBeInTheDocument()
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument()
      expect(screen.getByTestId('admin-password-input')).toBeInTheDocument()
    })
  })

  it('shows error when username is empty', async () => {
    renderWithAuth(<ProductionSetupChecklist />)
    await waitFor(() => {
      expect(screen.getByTestId('admin-create-submit')).toBeInTheDocument()
    })
    const submitBtn = screen.getByTestId('admin-create-submit')
    fireEvent.click(submitBtn)
    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('用户名不能为空')
    })
  })

  it('shows error when password is too short', async () => {
    renderWithAuth(<ProductionSetupChecklist />)
    await waitFor(() => {
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('admin-username-input'), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByTestId('admin-password-input'), {
      target: { value: 'short' },
    })
    fireEvent.change(screen.getByTestId('admin-confirm-password-input'), {
      target: { value: 'short' },
    })
    fireEvent.click(screen.getByTestId('admin-create-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('密码至少需要 8 个字符')
    })
  })

  it('shows error when passwords do not match', async () => {
    renderWithAuth(<ProductionSetupChecklist />)
    await waitFor(() => {
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('admin-username-input'), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByTestId('admin-password-input'), {
      target: { value: 'password123' },
    })
    fireEvent.change(screen.getByTestId('admin-confirm-password-input'), {
      target: { value: 'password456' },
    })
    fireEvent.click(screen.getByTestId('admin-create-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('两次输入的密码不一致')
    })
  })

  it('creates admin user and moves to step 2', async () => {
    renderWithAuth(<ProductionSetupChecklist />)
    await waitFor(() => {
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('admin-username-input'), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByTestId('admin-password-input'), {
      target: { value: 'password123' },
    })
    fireEvent.change(screen.getByTestId('admin-confirm-password-input'), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByTestId('admin-create-submit'))
    await waitFor(() => {
      expect(mockSetupUser).toHaveBeenCalledWith('admin', 'password123')
      expect(screen.getByText('创建 API 密钥')).toBeInTheDocument()
    })
  })

  it('allows skipping API key creation', async () => {
    renderWithAuth(<ProductionSetupChecklist />)
    await waitFor(() => {
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('admin-username-input'), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByTestId('admin-password-input'), {
      target: { value: 'password123' },
    })
    fireEvent.change(screen.getByTestId('admin-confirm-password-input'), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByTestId('admin-create-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('skip-api-key-btn')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('skip-api-key-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('readiness-connectors')).toBeInTheDocument()
    })
  })

  it('creates API key and shows the key', async () => {
    renderWithAuth(<ProductionSetupChecklist />)
    await waitFor(() => {
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('admin-username-input'), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByTestId('admin-password-input'), {
      target: { value: 'password123' },
    })
    fireEvent.change(screen.getByTestId('admin-confirm-password-input'), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByTestId('admin-create-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('api-key-name-input')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('api-key-name-input'), {
      target: { value: 'Test API Key' },
    })
    fireEvent.click(screen.getByTestId('api-key-create-submit'))
    await waitFor(() => {
      expect(adminApi.createApiKey).toHaveBeenCalledWith({
        name: 'Test API Key',
        role: 'admin',
      })
      expect(screen.getByText('API 密钥已创建')).toBeInTheDocument()
    })
  })

  it('shows production readiness checklist on step 3', async () => {
    renderWithAuth(<ProductionSetupChecklist />)
    await waitFor(() => {
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('admin-username-input'), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByTestId('admin-password-input'), {
      target: { value: 'password123' },
    })
    fireEvent.change(screen.getByTestId('admin-confirm-password-input'), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByTestId('admin-create-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('skip-api-key-btn')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('skip-api-key-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('readiness-app_secret_key')).toBeInTheDocument()
      expect(screen.getByTestId('readiness-cors')).toBeInTheDocument()
      expect(screen.getByTestId('readiness-connectors')).toBeInTheDocument()
    })
  })

  it('calls onComplete when setup is finished', async () => {
    const onComplete = vi.fn()
    renderWithAuth(<ProductionSetupChecklist onComplete={onComplete} />)
    await waitFor(() => {
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('admin-username-input'), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByTestId('admin-password-input'), {
      target: { value: 'password123' },
    })
    fireEvent.change(screen.getByTestId('admin-confirm-password-input'), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByTestId('admin-create-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('skip-api-key-btn')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('skip-api-key-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('complete-setup-btn')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('complete-setup-btn'))
    expect(onComplete).toHaveBeenCalled()
  })
})
