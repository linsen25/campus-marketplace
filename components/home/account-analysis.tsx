import type { MutableRefObject } from 'react'

import { ProfileAnalytics } from './profile-analytics'
import type { ChartReplayHistory } from './profile-chart-animation'

/** Account analytics rendered within Profile on desktop and mobile. */
export function AccountAnalysis({
  replayToken,
  replayHistory,
}: {
  replayToken: number
  replayHistory: MutableRefObject<ChartReplayHistory>
}) {
  return (
    <section aria-label="Account Analytics">
      <ProfileAnalytics
        replayToken={replayToken}
        replayHistory={replayHistory}
      />
    </section>
  )
}
