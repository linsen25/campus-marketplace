import type { MutableRefObject } from 'react'

import { ShopAnalysis } from '@/components/shops/shop-analytics'

import { ProfileAnalytics } from './profile-analytics'
import type { ChartReplayHistory } from './profile-chart-animation'

/** Dedicated Analysis destination shared by desktop/mobile; no Profile fields. */
export function AccountAnalysis({
  replayToken,
  replayHistory,
}: {
  replayToken: number
  replayHistory: MutableRefObject<ChartReplayHistory>
}) {
  return (
    <section aria-label="Analysis">
      <ProfileAnalytics
        replayToken={replayToken}
        replayHistory={replayHistory}
      />
      <ShopAnalysis replayToken={replayToken} />
    </section>
  )
}
