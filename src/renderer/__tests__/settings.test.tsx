import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPanel } from '../../renderer/components/SettingsPanel'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn()
}))

vi.mock('../../renderer/store/app-store', () => ({ useAppStore }))

let mockApi: MockApi
let mockStore: ReturnType<typeof createMockAppStore>
const user = userEvent.setup()

const PROVIDERS = [
  { name: 'openai', label: 'OpenAI', models: ['gpt-5-mini', 'gpt-4o'], configured: true },
  { name: 'anthropic', label: 'Anthropic', models: ['claude-sonnet-4-20250514'], configured: true },
  { name: 'azure', label: 'Azure OpenAI', models: ['azure:gpt-4o'], configured: false },
]

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.getSettings = vi.fn().mockResolvedValue({
    autoStart: 'false',
    runInBackground: 'false',
    default_model: 'gpt-5-mini',
    temperature: '0.7',
    max_tokens: '4096',
  })
  mockApi.listProviders = vi.fn().mockResolvedValue(PROVIDERS)
  mockApi.getAzureEndpoint = vi.fn().mockResolvedValue(null)

  mockStore = createMockAppStore({
    showSettings: true,
    theme: 'dark',
    globalDefaultModel: 'gpt-5-mini',
  })
  setupStoreMock(useAppStore, mockStore)
})

describe('SettingsPanel', () => {
  it('shows active model details in general tab', async () => {
    render(<SettingsPanel />)

    expect(screen.getByText('Active model')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('OpenAI')).toBeInTheDocument())
  })

  it('opens the providers tab with BYOK providers', async () => {
    render(<SettingsPanel />)
    await user.click(screen.getByText('API Providers'))

    await waitFor(() => {
      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('Anthropic')).toBeInTheDocument()
      expect(screen.getByText('Azure OpenAI')).toBeInTheDocument()
    })
  })

  it('keeps the general credential vault separate from API providers', async () => {
    render(<SettingsPanel />)
    await user.click(screen.getByText('Credentials'))

    expect(await screen.findByText(/separate from LLM API provider keys/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add credential/i })).toBeInTheDocument()
  })

  it('saves advanced settings values', async () => {
    render(<SettingsPanel />)
    await user.click(screen.getByText('Save advanced settings'))

    expect(mockApi.setSetting).toHaveBeenCalledWith('default_model', 'gpt-5-mini')
    expect(mockApi.setSetting).toHaveBeenCalledWith('temperature', '0.7')
    expect(mockApi.setSetting).toHaveBeenCalledWith('max_tokens', '4096')
  })

  it('persists the tray background execution preference', async () => {
    render(<SettingsPanel />)

    await user.click(screen.getByRole('switch', { name: 'Run in background' }))

    expect(mockApi.setSetting).toHaveBeenCalledWith('runInBackground', 'true')
  })

})
