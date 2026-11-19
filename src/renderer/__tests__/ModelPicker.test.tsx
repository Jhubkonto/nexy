import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModelPicker } from '../components/chat/ModelPicker'

describe('ModelPicker', () => {
  it('shows the selected source for a qualified model', () => {
    render(<ModelPicker value="openrouter:shared" availableGroups={[
      { sourceKey: 'openai', sourceLabel: 'OpenAI', sourceType: 'provider', models: [{ id: 'shared', label: 'Shared model' }] },
      { sourceKey: 'openrouter', sourceLabel: 'OpenRouter', sourceType: 'provider', models: [{ id: 'shared', label: 'Shared model' }] },
    ]} catalogModels={[]} onSelectAvailableModel={() => {}} />)
    expect(screen.getByRole('button', { name: 'Conversation model: Shared model · via OpenRouter' })).toBeTruthy()
  })
  it('ellipsizes long model labels and exposes the full label on hover', () => {
    const longLabel = 'Claude Haiku 4.5 20251001 extended reasoning'

    render(
      <ModelPicker
        value="claude-haiku-long"
        sourceLabel="global"
        availableGroups={[]}
        catalogModels={[{
          id: 'claude-haiku-long',
          name: longLabel,
          vendor: 'Anthropic',
          capabilities: [],
        }]}
        onSelectAvailableModel={vi.fn()}
      />,
    )

    const button = screen.getByRole('button', {
      name: `Conversation model: ${longLabel} · via global`,
    })
    expect(button).toHaveAttribute('title', `${longLabel} · via global`)
    expect(screen.getByText(longLabel)).toHaveClass('truncate', 'max-w-[140px]')
  })
  it('renders Hermes profile groups and resolves a bare model through the selected profile', () => {
    const select = vi.fn()
    const groups = [
      { sourceKey: 'hermes-cli:default', sourceLabel: 'Hermes · Default', sourceType: 'cli' as const, models: [{ id: 'openrouter/auto', label: 'Auto router' }] },
      { sourceKey: 'hermes-cli:localllm', sourceLabel: 'Hermes · localllm', sourceType: 'cli' as const, description: 'qwen3 · Local models', models: [{ id: 'openrouter/auto', label: 'Auto router' }] },
    ]
    render(<ModelPicker value="openrouter/auto" selectedSourceKey="hermes-cli:localllm" availableGroups={groups} catalogModels={[]} onSelectAvailableModel={select} />)
    const button = screen.getByRole('button', { name: 'Conversation model: Auto router · via Hermes · localllm' })
    fireEvent.click(button)
    // Profiles sit behind a single Hermes row rather than one top-level row each.
    expect(screen.queryByRole('button', { name: /^Default/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Hermes 2 profiles/ }))
    expect(screen.getByRole('button', { name: /^Default/ })).toBeInTheDocument()
    expect(screen.getByText('qwen3 · Local models')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search models...'), { target: { value: 'localllm' } })
    expect(screen.getByRole('button', { name: /^Hermes 1 profile/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: /^Default/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^localllm/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Auto router' }))
    expect(select).toHaveBeenCalledWith(groups[1], groups[1].models[0])
  })

  it('searches providers and selects a model from the adjacent menu', () => {
    const select = vi.fn()
    const group = { sourceKey: 'openai', sourceType: 'provider' as const, sourceLabel: 'OpenAI', models: [{ id: 'model-a', label: 'Model A' }] }
    render(<ModelPicker value="default" availableGroups={[group]} catalogModels={[]} onSelectAvailableModel={select} />)
    fireEvent.click(screen.getByRole('button', { name: /Conversation model/ }))
    fireEvent.change(screen.getByPlaceholderText('Search models...'), { target: { value: 'openai' } })
    expect(screen.queryByRole('button', { name: 'Model A' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Model A' }))
    expect(select).toHaveBeenCalledWith(group, group.models[0])
  })

})
