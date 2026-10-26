import { AnimatePresence } from 'framer-motion'
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import profile from '@/components/home/profile.module.css'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { StatefulButton } from '@/components/velora/stateful-button'
import { useOwnShopProfile } from '@/hooks/use-own-shop-profile'
import { shopCategories, shopIdentityError } from '@/lib/shop-presentation'
import type { ShopIdentity } from '@/lib/shop-presentation'

import { ShopPublicURL } from './shop-profile'
import styles from './shop-surfaces.module.css'

const steps: Array<keyof ShopIdentity | 'review'> = [
  'shopName',
  'category',
  'description',
  'review',
]

function emptyIdentity(): ShopIdentity {
  return { shopName: '', category: '', description: '' }
}

export function ShopProfileManager({
  ownShop,
  username,
}: {
  ownShop: ReturnType<typeof useOwnShopProfile>
  username: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<ShopIdentity>(emptyIdentity)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const dismissed = useRef(false)
  const identity = useMemo<ShopIdentity>(
    () =>
      ownShop.shop
        ? {
            shopName: ownShop.shop.name,
            category: ownShop.shop.category,
            description: ownShop.shop.description,
          }
        : emptyIdentity(),
    [ownShop.shop]
  )
  const createMode = !ownShop.shop
  const validation = shopIdentityError(draft)
  const currentField = steps[step]
  const fieldError = (field: keyof ShopIdentity) => {
    if (field === 'shopName')
      return !draft.shopName.trim() || draft.shopName.trim().length > 40
        ? 'Use a Shop name between 1 and 40 characters.'
        : ''
    if (field === 'category')
      return shopCategories.includes(
        draft.category as typeof shopCategories[number]
      )
        ? ''
        : 'Choose a Shop category.'
    return !draft.description.trim() || draft.description.trim().length > 200
      ? 'Use a description between 1 and 200 characters.'
      : ''
  }
  const fieldValid = currentField === 'review' || !fieldError(currentField)

  useEffect(() => {
    if (
      ownShop.status === 'absent' &&
      ownShop.applicationStatus === 'approved' &&
      !editing &&
      !dismissed.current
    ) {
      setDraft(emptyIdentity())
      setStep(0)
      setError('')
      setEditing(true)
    }
  }, [ownShop.status, ownShop.applicationStatus, editing])

  const open = (create: boolean) => {
    dismissed.current = false
    setDraft(create ? emptyIdentity() : identity)
    setStep(0)
    setError('')
    setEditing(true)
  }
  const close = () => {
    if (!pending) {
      dismissed.current = true
      setEditing(false)
      setError('')
    }
  }
  const submit = async () => {
    if (validation || pending) return
    setPending(true)
    setError('')
    try {
      if (createMode)
        await ownShop.create({
          name: draft.shopName.trim(),
          category: draft.category,
          description: draft.description.trim(),
        })
      else await ownShop.save(draft)
      setEditing(false)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Unable to save Shop profile.'
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      className={`${profile.panel} ${styles.area}`}
      aria-label="Shop Profile"
      data-shop-profile="true"
    >
      <header className={profile.panelHeader}>
        <h3>Shop Profile</h3>
        {ownShop.shop && (
          <StatefulButton className={styles.action} onClick={() => open(false)}>
            <Pencil size={15} aria-hidden="true" /> Edit Shop Profile
          </StatefulButton>
        )}
      </header>
      {ownShop.status === 'loading' && (
        <p className={styles.inactive}>Loading Shop profile…</p>
      )}
      {ownShop.status === 'error' && (
        <p className={styles.inactive} role="alert">
          Unable to load Shop profile. Please retry.
        </p>
      )}
      {ownShop.status === 'anonymous' && (
        <p className={styles.inactive}>Log in to manage your Shop.</p>
      )}
      {ownShop.status === 'absent' && (
        <p className={styles.inactive}>
          {ownShop.applicationStatus === 'pending'
            ? 'Your Shop application is pending review.'
            : ownShop.applicationStatus === 'rejected'
            ? 'Your Shop application was not approved.'
            : ownShop.applicationStatus === 'approved'
            ? 'Create your Shop profile to get started.'
            : 'Shop approval is required before you can create a Shop.'}
        </p>
      )}
      {ownShop.shop && (
        <div className={styles.identity}>
          <h4>{ownShop.shop.name}</h4>
          <p>{ownShop.shop.category}</p>
          <p className={styles.description}>{ownShop.shop.description}</p>
          {username && <ShopPublicURL username={username} />}
        </div>
      )}
      {ownShop.status === 'absent' &&
        ownShop.applicationStatus === 'approved' &&
        !editing && (
          <StatefulButton className={styles.action} onClick={() => open(true)}>
            <Plus size={16} aria-hidden="true" /> Create Shop Profile
          </StatefulButton>
        )}
      {error && (
        <p className={profile.error} role="alert">
          {error}
        </p>
      )}
      <AnimatePresence>
        {editing && (
          <FadingDialog
            className={profile.dialog}
            aria-label={createMode ? 'Create Shop' : 'Edit Shop Profile'}
            dismissOnBackdrop={false}
            focusAtTop={true}
            onRequestClose={close}
          >
            <header className={profile.panelHeader}>
              <h3>{createMode ? 'Create Shop' : 'Edit Shop Profile'}</h3>
              <button
                type="button"
                aria-label="Close Shop Profile"
                onClick={close}
                disabled={pending}
              >
                <X size={20} />
              </button>
            </header>
            <p className={profile.caption}>
              Step {step + 1} of {steps.length}
            </p>
            {currentField === 'shopName' && (
              <label className={styles.field}>
                Shop Name
                <input
                  value={draft.shopName}
                  maxLength={40}
                  disabled={pending}
                  onChange={(e) =>
                    setDraft({ ...draft, shopName: e.target.value })
                  }
                  autoFocus
                />
              </label>
            )}
            {currentField === 'category' && (
              <label className={styles.field}>
                Category
                <select
                  value={draft.category}
                  disabled={pending}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value })
                  }
                >
                  <option value="">Choose a category</option>
                  {shopCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {currentField === 'description' && (
              <label className={styles.field}>
                Description
                <textarea
                  value={draft.description}
                  maxLength={200}
                  disabled={pending}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  autoFocus
                />
              </label>
            )}
            {currentField === 'review' && (
              <div className={styles.identity}>
                <p>
                  <strong>Shop Name</strong>
                  <br />
                  {draft.shopName}
                </p>
                <p>
                  <strong>Category</strong>
                  <br />
                  {draft.category}
                </p>
                <p>
                  <strong>Description</strong>
                  <br />
                  {draft.description}
                </p>
              </div>
            )}
            {currentField !== 'review' && !fieldValid && (
              <p className={profile.error}>{fieldError(currentField)}</p>
            )}
            <div className={styles.editorActions}>
              <StatefulButton
                className={`${styles.action} ${styles.cancel}`}
                disabled={pending || step === 0}
                onClick={() => setStep((value) => value - 1)}
              >
                <ChevronLeft size={16} /> Back
              </StatefulButton>
              {step < steps.length - 1 ? (
                <StatefulButton
                  className={styles.action}
                  disabled={pending || !fieldValid}
                  onClick={() => setStep((value) => value + 1)}
                >
                  Next <ChevronRight size={16} />
                </StatefulButton>
              ) : (
                <StatefulButton
                  className={styles.action}
                  disabled={pending || Boolean(validation)}
                  onClick={submit}
                >
                  <Check size={16} /> Confirm & Save
                </StatefulButton>
              )}
            </div>
          </FadingDialog>
        )}
      </AnimatePresence>
    </section>
  )
}
