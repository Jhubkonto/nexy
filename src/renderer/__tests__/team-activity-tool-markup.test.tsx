import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TeamActivityBlock } from '../components/TeamActivityBlock'

describe('team activity tool markup', () => {
  it('shows a saved textual tool call as a failed step', () => {
    render(<TeamActivityBlock steps={[{
      stepId: 'step', agentId: 'agent', agentName: 'Agent', agentIcon: '', task: 'Inspect',
      status: 'done', result: '<bash><command>ls -la</command></bash>',
    }]} />)
    fireEvent.click(screen.getByRole('button', { name: /Team Activity/ }))
    expect(screen.getByText(/No tool call was executed/)).toBeInTheDocument()
    expect(screen.queryByText(/ls -la/)).not.toBeInTheDocument()
    expect(screen.getByText('0/1 done')).toBeInTheDocument()
  })
})
