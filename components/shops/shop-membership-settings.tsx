import { useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { ActionTone } from '@/components/ui/action-tone'
import PricingCard from '@/components/pricing-card'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { useOwnShopProfile } from '@/hooks/use-own-shop-profile'
import { shopCategories, shopIdentityError } from '@/lib/shop-presentation'
import type { ShopIdentity } from '@/lib/shop-presentation'
import type { DevShopTier } from '@/hooks/use-shop-membership-access'
import type { ShopMembership } from '@/types/shop-membership'

import { demoShopIdentity, lunaStudioDemo } from './shop-demo-data'
import styles from './shop-membership-settings.module.css'

function displayDate(value: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : date.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
}

function elapsedMembership(start: string | null) {
  if (!start) return 'Not available'
  const date = new Date(start)
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now())
    return 'Not available'
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000))
  if (days === 0) return 'Started today'
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'}`
  const months = Math.floor(days / 30)
  const remaining = days % 30
  return remaining ? `${months} mo ${remaining} d` : `${months} mo`
}

function membershipSummary(membership: ShopMembership | null) {
  if (!membership)
    return {
      plan: 'No active plan',
      start: null,
      end: null,
      billing: 'No active billing cycle',
      status: 'Not active',
    }
  return {
    plan: membership.effectiveTier
      ? membership.effectiveTier === 'plus'
        ? 'Plus'
        : 'Pro'
      : 'No active plan',
    start: membership.currentTermStart,
    end: membership.currentTermEnd,
    billing: membership.purchaseMode
      ? membership.purchaseMode === 'auto_renew'
        ? 'Auto-renew'
        : 'One-month term'
      : 'Not available',
    status: membership.status || 'Not available',
  }
}

/** Shop Settings presentation: real billing status is never replaced with dev simulation. */
export function ShopMembershipSettings({
  membership,
  simulation,
  simulationStartedAt,
  onExitSimulation,
  demo = false,
}: {
  membership: ShopMembership | null
  simulation: DevShopTier | null
  simulationStartedAt: string | null
  onExitSimulation: () => void
  /** Explicit, development-only data is injected by the Home shell. */
  demo?: boolean
}) {
  const profile = useOwnShopProfile(!demo)
  const [confirmExit, setConfirmExit] = useState(false)
  const [changeOpen, setChangeOpen] = useState(false)
  const [previewNotice, setPreviewNotice] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [editBase, setEditBase] = useState<string | null>(null)
  const [draft, setDraft] = useState<ShopIdentity>({
    shopName: '',
    category: '',
    description: '',
  })
  const [demoPreview, setDemoPreview] = useState<ShopIdentity | null>(null)

  const summary = membershipSummary(membership)

  const openEditor = () => {
    if (demo) {
      setDraft(
        demoPreview || {
          shopName: demoShopIdentity.shopName,
          category: lunaStudioDemo.category,
          description: lunaStudioDemo.about,
        }
      )
      setEditBase(null)
    } else {
      if (profile.status !== 'ready' || !profile.shop || !profile.etag) return

      setDraft({
        shopName: profile.shop.name,
        category: profile.shop.category,
        description: profile.shop.description,
      })
      setEditBase(profile.etag)
    }

    setEditError('')
    setEditOpen(true)
  }

  const saveEditor = async () => {
    if (editSaving) return

    const next: ShopIdentity = {
      shopName: draft.shopName.trim(),
      category: draft.category,
      description: draft.description.trim(),
    }

    const validationError = demo
      ? !next.shopName || next.shopName.length > 40
        ? 'Use a Shop name between 1 and 40 characters.'
        : !next.description || next.description.length > 200
        ? 'Use a description between 1 and 200 characters.'
        : !next.category
        ? 'Choose a Shop category.'
        : ''
      : shopIdentityError(next)

    if (validationError) {
      setEditError(validationError)
      return
    }

    if (demo) {
      setDemoPreview(next)
      setEditOpen(false)
      return
    }

    if (profile.status !== 'ready' || !profile.shop || !editBase) {
      setEditError('Shop profile unavailable. Reopen Settings to retry.')
      return
    }

    setEditSaving(true)
    setEditError('')

    try {
      await profile.save(next, editBase)
      setEditOpen(false)
    } catch (error) {
      setEditError(
        error instanceof Error
          ? error.message
          : 'Unable to save Shop details. Please retry.'
      )
    } finally {
      setEditSaving(false)
    }
  }
  const shopName = demo
    ? demoPreview?.shopName || demoShopIdentity.shopName
    : profile.status === 'ready' && profile.shop?.name
    ? profile.shop.name
    : profile.status === 'loading'
    ? 'Loading Shop name…'
    : 'Shop profile unavailable'

  return (
    <section
      className={styles.page}
      aria-label="Shop Settings"
      data-shop-settings-v1="true"
    >
      <section className={styles.panel} data-shop-membership-settings="true">
        <header>
          <div>
            <p className={styles.eyebrow}>Shop Settings</p>
            <h2>Membership &amp; Shop details</h2>
            <p className={styles.subtitle}>
              Manage your membership and key shop details.
            </p>
          </div>
        </header>
        <dl className={styles.rows}>
          <div>
            <dt>Shop Name</dt>
            <dd>{shopName}</dd>
          </div>
          <div>
            <dt>Current Plan</dt>
            <dd>{summary.plan}</dd>
          </div>
          <div>
            <dt>Membership Status</dt>
            <dd>{summary.status}</dd>
          </div>
          <div>
            <dt>Start Date</dt>
            <dd>{displayDate(summary.start)}</dd>
          </div>
          <div>
            <dt>Term End Date</dt>
            <dd>{displayDate(summary.end)}</dd>
          </div>
          <div>
            <dt>Membership Duration</dt>
            <dd>{elapsedMembership(summary.start)}</dd>
          </div>
          <div>
            <dt>Billing Cycle</dt>
            <dd>{summary.billing}</dd>
          </div>
        </dl>
        <div className={styles.actions}>
          <ShiningButton
            variant="purple"
            size="compact"
            showArrow={false}
            onClick={() => {
              setPreviewNotice('')
              setChangeOpen(true)
            }}
          >
            Change plan
          </ShiningButton>
          <ShiningButton
            variant="red"
            size="compact"
            showArrow={false}
            disabled={true}
          >
            Cancel plan
          </ShiningButton>
        </div>
        <p className={styles.actionNote}>
          Plan changes and cancellation are unavailable until the verified
          billing-management flow is connected.
        </p>
      </section>

      <section className={styles.panel} aria-label="Shop configuration">
        <header>
          <div>
            <p className={styles.eyebrow}>Shop Configuration</p>
            <h2>Shop settings</h2>
            <p className={styles.subtitle}>
              Your existing shop profile information.
            </p>
          </div>
        </header>
        <dl className={styles.rows}>
          <div>
            <dt>Shop Name</dt>
            <dd>{shopName}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>
              {demo
                ? demoPreview?.category || lunaStudioDemo.category
                : profile.status === 'ready'
                ? profile.shop?.category || 'Not available'
                : 'Not available'}
            </dd>
          </div>
          <div>
            <dt>Description</dt>
            <dd>
              {demo
                ? demoPreview?.description || lunaStudioDemo.about
                : profile.status === 'ready'
                ? profile.shop?.description || 'Not available'
                : 'Not available'}
            </dd>
          </div>
          <div>
            <dt>Shop Profile</dt>
            <dd>
              {demo
                ? 'Local preview only'
                : profile.status === 'ready'
                ? 'Available'
                : 'Not available'}
            </dd>
          </div>
        </dl>
        <div className={styles.editActions}>
          <ShiningButton
            variant="purple"
            size="compact"
            showArrow={false}
            disabled={
              !demo &&
              (profile.status !== 'ready' || !profile.shop || !profile.etag)
            }
            onClick={openEditor}
          >
            Edit shop details
          </ShiningButton>
        </div>
        <p className={styles.actionNote}>
          {demo
            ? 'Local preview only. Changes will not be saved to your account.'
            : 'Manage your Shop name, category, and public description.'}
        </p>
      </section>

      {process.env.NODE_ENV === 'development' && (simulation || demo) && (
        <section className={styles.testing} aria-label="Development testing">
          <header>
            <div>
              <p className={styles.eyebrow}>Development Testing</p>
              <h2>Local membership simulation</h2>
              <p className={styles.subtitle}>
                Preview-only data. No real subscription or payment is changed.
              </p>
            </div>
            <span className={styles.demo}>Dev only</span>
          </header>
          <dl className={styles.rows}>
            <div>
              <dt>Simulated Plan</dt>
              <dd>
                {simulation
                  ? `Test ${simulation === 'plus' ? 'Plus' : 'Pro'}`
                  : 'Demo preview'}
              </dd>
            </div>
            <div>
              <dt>Simulation Started</dt>
              <dd>{displayDate(simulationStartedAt)}</dd>
            </div>
          </dl>
          {simulation && (
            <button
              type="button"
              className={styles.exit}
              onClick={() => setConfirmExit(true)}
            >
              Exit Test Membership
            </button>
          )}
        </section>
      )}

      {editOpen && (
        <FadingDialog
          className={styles.editDialog}
          aria-label="Edit shop details"
          focusAtTop={true}
          tabIndex={-1}
          dismissOnBackdrop={!editSaving}
          onRequestClose={() => {
            if (!editSaving) setEditOpen(false)
          }}
        >
          <div className={styles.changeHeading}>
            <div>
              <h3>Edit shop details</h3>
              <p>Manage your Shop identity and public information.</p>
            </div>
            <button
              type="button"
              className={styles.close}
              aria-label="Close shop editor"
              disabled={editSaving}
              onClick={() => setEditOpen(false)}
            >
              ×
            </button>
          </div>

          {demo && (
            <p className={styles.previewWarning}>
              Preview only — changes will not be saved to your account.
            </p>
          )}

          <form
            className={styles.editForm}
            onSubmit={(event) => {
              event.preventDefault()
              void saveEditor()
            }}
          >
            <label className={styles.editField}>
              <span>Shop Name</span>
              <input
                type="text"
                maxLength={40}
                required
                disabled={editSaving}
                value={draft.shopName}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    shopName: event.target.value,
                  }))
                }
              />
            </label>

            <label className={styles.editField}>
              <span>Category</span>
              <select
                value={draft.category}
                required
                disabled={editSaving}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
              >
                <option value="" disabled>
                  Select a category
                </option>
                {demo && (
                  <option value={lunaStudioDemo.category}>
                    {lunaStudioDemo.category} (Demo)
                  </option>
                )}
                {shopCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.editField}>
              <span>Description</span>
              <textarea
                rows={4}
                maxLength={200}
                required
                disabled={editSaving}
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
              <small>{draft.description.length}/200 characters</small>
            </label>

            {editError && (
              <p className={styles.editError} role="alert">
                {editError}
              </p>
            )}

            <div className={styles.editFooter}>
              <button
                type="button"
                className={styles.editCancel}
                disabled={editSaving}
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.editSave}
                disabled={editSaving}
              >
                {editSaving
                  ? 'Saving...'
                  : demo
                  ? 'Apply preview'
                  : 'Save changes'}
              </button>
            </div>
          </form>
        </FadingDialog>
      )}
      {changeOpen && (
        <FadingDialog
          className={styles.changeDialog}
          aria-label="Change Shop plan preview"
          focusAtTop={true}
          tabIndex={-1}
          onRequestClose={() => setChangeOpen(false)}
        >
          <div className={styles.changeHeading}>
            <div>
              <h3>Change plan</h3>
              <p>Explore your existing UU Shop plans.</p>
            </div>
            <button
              type="button"
              aria-label="Close change plan"
              className={styles.close}
              onClick={() => setChangeOpen(false)}
            >
              ×
            </button>
          </div>
          <p className={styles.previewWarning}>
            Preview only — this does not change, charge, or cancel your current
            membership.
          </p>
          <div className={styles.pricingPreview}>
            <PricingCard
              showTrialPreview={true}
              trialPreview={true}
              onPreviewNotice={setPreviewNotice}
            />
          </div>
          {previewNotice && (
            <p role="status" className={styles.actionNote}>
              {previewNotice}
            </p>
          )}
        </FadingDialog>
      )}

      {confirmExit && (
        <ConfirmationDialog
          tone={ActionTone.Danger}
          title="Exit test membership?"
          description="This clears only this browser's local development simulation. It does not cancel or change any real Shop membership."
          onRequestClose={() => setConfirmExit(false)}
          cancel={{
            label: 'Keep test membership',
            onClick: () => setConfirmExit(false),
          }}
          confirm={{
            label: 'Exit test membership',
            onClick: () => {
              onExitSimulation()
              setConfirmExit(false)
            },
          }}
        />
      )}
    </section>
  )
}
