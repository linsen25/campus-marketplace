import { AnimatePresence } from 'framer-motion'
import { useEffect, useId, useRef, useState } from 'react'

import FilterInteraction from '@/components/filter-interaction'
import profile from '@/components/home/profile.module.css'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { StatefulButton } from '@/components/velora/stateful-button'
import { shopCategories, shopIdentityError } from '@/lib/shop-presentation'
import type { ShopIdentity } from '@/lib/shop-presentation'
import type { ShopPreview } from '@/types/shop'

import { ShopPublicURL } from './shop-profile'
import styles from './shop-surfaces.module.css'

type Field = keyof ShopIdentity
const labels: Record<Field, string> = {
  shopName: 'Shop name',
  category: 'Category',
  description: 'Description',
}

function ShopEditor({
  field,
  shop,
  onSave,
  onClose,
  live,
}: {
  field: Field
  shop: ShopPreview
  onSave: (patch: Partial<ShopIdentity>) => Promise<void>
  onClose: () => void
  live: boolean
}) {
  const [value, setValue] = useState(shop[field])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const saving = useRef(false)
  const [open, setOpen] = useState(false)
  const [portal, setPortal] = useState<HTMLDivElement | null>(null)
  const titleId = useId()
  const validation = shopIdentityError({ ...shop, [field]: value })
  const save = async () => {
    if (validation || saving.current) return
    saving.current = true
    setPending(true)
    setError('')
    try {
      await onSave({ [field]: value.trim() })
      onClose()
    } catch (reason) {
      setError(
        live && reason instanceof Error
          ? reason.message
          : 'Unable to save this Shop change. Please retry.'
      )
      throw Error('Unable to save Shop change')
    } finally {
      setPending(false)
      saving.current = false
    }
  }
  return (
    <FadingDialog
      className={profile.dialog}
      aria-labelledby={titleId}
      onRequestClose={() => {
        if (!pending) onClose()
      }}
    >
      <h3 id={titleId}>Change {labels[field].toLowerCase()}</h3>
      {field === 'category' ? (
        <div className={styles.field}>
          <p>Category</p>
          <FilterInteraction
            label="Category"
            appearance="select"
            options={shopCategories.map((category) => ({
              value: category,
              label: category,
            }))}
            value={value}
            isOpen={open}
            portalContainer={portal}
            disabled={pending}
            onOpenChange={setOpen}
            onChange={setValue}
          />
        </div>
      ) : (
        <label className={styles.field}>
          {labels[field]}
          {field === 'description' ? (
            <textarea
              value={value}
              maxLength={200}
              disabled={pending}
              onChange={(e) => setValue(e.target.value)}
            />
          ) : (
            <input
              value={value}
              maxLength={40}
              disabled={pending}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </label>
      )}
      <div ref={setPortal} />
      <p className={profile.caption}>
        {live
          ? 'Changes are saved to your Shop profile.'
          : 'UI fixture editor · Changes are not saved to a real Shop.'}
      </p>
      {validation && <p className={profile.error}>{validation}</p>}
      {error && (
        <p className={profile.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.editorActions}>
        <StatefulButton
          className={`${styles.action} ${styles.cancel}`}
          disabled={pending}
          onClick={onClose}
        >
          Cancel
        </StatefulButton>
        <StatefulButton
          className={styles.action}
          disabled={Boolean(validation) || pending}
          onClick={save}
        >
          Save changes
        </StatefulButton>
      </div>
    </FadingDialog>
  )
}

/** Private owner editing; explicit fixture injection stays separate from live data. */
export function ShopSettings({
  shop,
  username,
  onSave,
  status,
  version,
  live = false,
}: {
  shop?: ShopPreview
  username: string | null
  onSave?: (patch: Partial<ShopIdentity>, version?: string) => Promise<void>
  status?: 'absent' | 'anonymous' | 'error' | 'loading' | 'ready'
  version?: string
  live?: boolean
}) {
  const [editing, setEditing] = useState<{
    field: Field
    shop: ShopPreview
    version?: string
  } | null>(null)
  const active = Boolean(
    shop && onSave && (!live || status === 'ready' || status === 'error')
  )
  useEffect(() => {
    if (status === 'anonymous') setEditing(null)
  }, [status])
  const feedback = {
    loading: 'Loading Shop settings…',
    anonymous: 'Log in to manage your Shop.',
    error: 'Unable to load Shop settings. Reopen Settings to retry.',
    ready: '',
    absent: 'Your account does not have a Shop yet.',
  }[status || 'absent']
  return (
    <section
      className={`${profile.panel} ${profile.settings} ${styles.area}`}
      aria-label="Shop settings"
      data-shop-surface="settings"
      data-shop-active={active}
    >
      <header className={profile.panelHeader}>
        <h3>Shop</h3>
      </header>
      {(Object.keys(labels) as Field[]).map((field) => (
        <div key={field} className={profile.accountRow}>
          <div>
            <span className={profile.fieldLabel}>{labels[field]}</span>
            <p
              className={
                field === 'description' ? styles.description : undefined
              }
            >
              {active ? shop?.[field] : '—'}
            </p>
          </div>
          {active && (
            <StatefulButton
              className={styles.action}
              aria-label={`Change ${labels[field].toLowerCase()}`}
              onClick={() => {
                if (shop) setEditing({ field, shop, version })
              }}
            >
              Change
            </StatefulButton>
          )}
        </div>
      ))}
      <div className={profile.accountRow}>
        <div>
          <span className={profile.fieldLabel}>Shop URL</span>
          <p>
            {active && username ? <ShopPublicURL username={username} /> : '—'}
          </p>
          {active && <p className={profile.caption}>Based on your username</p>}
        </div>
      </div>
      {(!active || status === 'error') && (
        <p className={styles.inactive}>{feedback}</p>
      )}
      <AnimatePresence>
        {editing && shop && onSave && active && (
          <ShopEditor
            key={editing.field}
            field={editing.field}
            shop={editing.shop}
            live={live}
            onSave={(patch) => onSave(patch, editing.version)}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>
    </section>
  )
}
