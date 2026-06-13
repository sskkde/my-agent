import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ProductionSetupChecklist from './ProductionSetupChecklist'
import * as adminApi from '../../api/admin'
import * as client from '../../api/client'
import { AuthProvider } from '../../context/AuthContext'

vi.mock('../../api/admin')
vi.mock('../../api/client')

const mockSetupUser = vi.fn()
const mockGetReadiness = vi.fn()
vi.mocked(client.setupUser).mockImplementation(mockSetupUser)
vi.mocked(client.getReadiness).mockImplementation(mockGetReadiness)

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
    mockGetReadiness.mockResolvedValue({
      items: [
        {
          id: 'app_secret_key',
          label: 'APP_SECRET_KEY Configuration',
          status: 'ok',
          details: 'APP_SECRET_KEY is configured.',
        },
        {
          id: 'cors',
          label: 'CORS Configuration',
          status: 'ok',
          details: 'CORS is configured.',
        },
        {
          id: 'https',
          label: 'HTTPS Configuration',
          status: 'warning',
          details: 'HTTPS check skipped in dev.',
        },
        {
          id: 'database',
          label: 'Database Health',
          status: 'ok',
          details: 'Database is healthy.',
        },
        {
          id: 'stores',
          label: 'Stores Health',
          status: 'ok',
          details: 'Stores are healthy.',
        },
      ],
      timestamp: '2024-01-01T00:00:00Z',
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
      expect(screen.getByTestId('setup-admin-error')).toHaveTextContent('用户名不能为空')
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
      expect(screen.getByTestId('setup-admin-error')).toHaveTextContent('密码至少需要 8 个字符')
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
      expect(screen.getByTestId('setup-admin-error')).toHaveTextContent('两次输入的密码不一致')
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

  it('setup flow continues after admin creation (setupInProgress prevents unmount)', async () => {
    const onComplete = vi.fn()
    renderWithAuth(<ProductionSetupChecklist onComplete={onComplete} />)
    
    // Create admin user
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
    
    // After admin creation, should still be in setup flow (step 2 - API key)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '创建 API 密钥' })).toBeInTheDocument()
      expect(screen.getByTestId('skip-api-key-btn')).toBeInTheDocument()
    })
    
    // Should NOT have called onComplete yet
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('fetches readiness items from backend API', async () => {
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
    
    // Should call getReadiness API
    await waitFor(() => {
      expect(mockGetReadiness).toHaveBeenCalled()
    })
    
    // Should display items from API
    await waitFor(() => {
      expect(screen.getByTestId('readiness-app_secret_key')).toBeInTheDocument()
      expect(screen.getByTestId('readiness-cors')).toBeInTheDocument()
      expect(screen.getByTestId('readiness-database')).toBeInTheDocument()
    })
  })

  it('handles readiness API failure gracefully', async () => {
    mockGetReadiness.mockRejectedValue(new Error('Network error'))
    
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
    
    // Should show error item when API fails
    await waitFor(() => {
      expect(screen.getByTestId('readiness-api_error')).toBeInTheDocument()
    })
    
    // Should show error status
    const errorItem = screen.getByTestId('readiness-api_error')
    expect(errorItem).toHaveClass('error')
  })
})
