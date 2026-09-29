import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PromptLibraryModal } from '../../renderer/components/PromptLibraryModal'
import { setupMockApi } from '../../test/mocks/api'

beforeEach(() => {
  setupMockApi()
})

describe('PromptLibraryModal', () => {
  it('opens on the save form with message content prefilled', async () => {
    render(
      <PromptLibraryModal
        projectId="project-1"
        projectName="Nexy"
        draftContent={'Review this implementation\nfor correctness.'}
        initialMode="save"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(await screen.findByRole('heading', { name: 'Save a prompt' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Review this implementation')
    expect(screen.getByLabelText('Prompt')).toHaveValue(
      'Review this implementation\nfor correctness.'
    )
    expect(screen.getByLabelText('Scope')).toHaveValue('project')
  })

  it('reconciles the selected prompt and form when its project context changes', async () => {
    const api = setupMockApi()
    api.listPrompts.mockImplementation(async (projectId) => [
      {
        id: projectId === 'project-a' ? 'prompt-a' : 'prompt-b',
        title: projectId === 'project-a' ? 'Project A prompt' : 'Project B prompt',
        body: 'Body',
        description: '',
        category: 'Custom',
        tags: [],
        variables: [],
        scope: 'project',
        project_id: projectId,
        created_at: 1,
        updated_at: 1,
      },
    ])

    const view = render(
      <PromptLibraryModal
        projectId="project-a"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(await screen.findByRole('heading', { name: 'Project A prompt' })).toBeInTheDocument()
    view.rerender(
      <PromptLibraryModal
        projectId="project-b"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(await screen.findByRole('heading', { name: 'Project B prompt' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Project A prompt' })).not.toBeInTheDocument())
    expect(api.listPrompts).toHaveBeenLastCalledWith('project-b')
  })
})
