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
