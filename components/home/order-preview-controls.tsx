import type { PreviewRole } from '@/lib/order-interaction-preview'

import { useOrderVisual } from './order-visual-context'
import profile from './profile.module.css'

/** Changes only the shared, ephemeral Order preview perspective. */
export function OrderPreviewControls({
  role,
  onChange,
}: {
  role: PreviewRole
  onChange?: (role: PreviewRole) => void
}) {
  const visuals = useOrderVisual()
  if (!visuals.enabled) return null
  return (
    <section
      aria-label="Preview Controls"
      style={{ padding: '8px 12px', flexShrink: 0 }}
    >
      <p className={profile.caption}>
        Preview Controls / STAGING / PREVIEW ONLY
      </p>
      <div
        className={profile.segment}
        role="group"
        aria-label="Preview perspective"
      >
        {(['buyer', 'seller'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={role === value}
            onClick={() => (onChange || visuals.setRole)(value)}
          >
            {value === 'buyer' ? 'Buyer view' : 'Seller view'}
          </button>
        ))}
      </div>
    </section>
  )
}
