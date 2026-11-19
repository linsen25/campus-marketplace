import type { ReactNode } from 'react'

import { ActionRow } from './action-row'

/**
 * The shared two-action footer for small dialogs. ActionRow remains the single
 * layout authority; callers retain control of button colors and async state.
 */
export function DialogActions({ children }: { children: ReactNode }) {
  return (
    <ActionRow align="between" compactBetween>
      {children}
    </ActionRow>
  )
}
