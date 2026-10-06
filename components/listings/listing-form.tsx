/* eslint @next/next/no-img-element: off -- Local object URLs and immutable listing photos. */
import { AnimatePresence } from 'framer-motion'
import { ArrowLeft, ArrowRight } from 'lucide-react'
/* eslint jsx-a11y/no-onchange: off -- Form controls update only the local preview. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AccessibleAction } from '@/components/accessible-action'
import WorkButton from '@/components/animata/button/work-button'
import GlideSelect from '@/components/ui/GlideSelect'
import { ActionRow } from '@/components/ui/action-row'
import { DynamicAction } from '@/components/ui/dynamic-action'
import {
  ExpandableCard,
  ExpandedCardPreview,
} from '@/components/velora/expandable-card'
import { FileDrop } from '@/components/velora/file-drop'
import { StatefulButton } from '@/components/velora/stateful-button'
import {
  changeBuilderCategory,
  initialListingFields,
  validateBuilder,
} from '@/lib/listing-builder'
import type { ListingFields } from '@/lib/listing-builder'
import { validateListingImage } from '@/lib/listing-images'
import { listingCategories, listingConditions } from '@/lib/listing-metadata'
import {
  createPublishedListing,
  continueListingPublication,
  reconcileListingPublication,
} from '@/lib/listing-publication'
import type { PublicationResult } from '@/lib/listing-publication'
import { listingLimits } from '@/lib/listing-validation'
import { abandonListing, updateListing } from '@/lib/listings-api'
import {
  marketLocations,
  marketSubcategoryOptions,
} from '@/lib/market-taxonomy'
import type { Listing } from '@/types/listing'
import { formatListingPrice } from '@/utils/format-listing-price'
import { parseListingPrice } from '@/utils/parse-listing-price'

import { CardAction } from './card-actions'
import { CreateSuccess } from './create-success'
import successStyles from './create-success.module.css'
import { ListingConfirmation } from './listing-confirmation'
import { ListingMedia } from './listing-media'
import uploaderStyles from './listing-uploader.module.css'
import styles from './listing-workspace.module.css'
import { useMarketplaceSession } from './marketplace-session'
import { ListingDetails } from './published-listing-card'

export type ListingLeaveGuard = (leave: () => void) => void
export type ListingFormProps = {
  listing?: Listing
  onCancel?: () => void
  onSaved?: (listing: Listing) => void
  onGuardChange?: (guard: ListingLeaveGuard | null) => void
}
const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : 'Unable to save. Please try again.'

// eslint-disable-next-line complexity -- Create/edit share the same controlled form and publication boundary.
export function ListingForm({
  listing,
  onCancel,
  onSaved,
  onGuardChange,
}: ListingFormProps) {
  const { seller } = useMarketplaceSession()
  const initial = useMemo(() => initialListingFields(listing), [listing])
  const [fields, setFields] = useState(initial)
  const [files, setFiles] = useState<File[]>([])
  const [urls, setUrls] = useState<string[]>([])
  const [photoIndex, setPhotoIndex] = useState(0)
  const [error, setError] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<Listing | null>(null)
  const [successReady, setSuccessReady] = useState(false)
  const [createGeneration, setCreateGeneration] = useState(0)
  const builderRef = useRef<HTMLDivElement>(null)
  const createBuffer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(createBuffer.current), [])
  const createStateChanged = useCallback((state: string) => {
    if (state === 'success') setSuccessReady(true)
  }, [])
  const [previewOpen, setPreviewOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const photoCards = useMemo(
    () =>
      urls.length
        ? urls.map((image, index) => ({ id: `photo-${index}`, image }))
        : [
            {
              id: 'empty',
              color: '#2a2134',
              content: (
                <span className={uploaderStyles.choose}>
                  No photos selected
                </span>
              ),
            },
          ],
    [urls]
  )
  const photosRef = useRef<HTMLDivElement>(null)
  const [previewRect, setPreviewRect] = useState({
    left: 24,
    top: 100,
    width: 80,
  })
  const [pending, setPending] = useState<Exclude<
    PublicationResult,
    { state: 'published' }
  > | null>(null)
  const selectPhotos = (selected: File[]) => {
    if (busy || pending) return
    try {
      if (files.length + selected.length > 6)
        throw new Error('Choose at most 6 photos.')
      selected.forEach(validateListingImage)
      setFiles((current) => [...current, ...selected])
      setPhotoError('')
    } catch (reason) {
      setPhotoError(message(reason))
    }
  }
  const submitting = useRef(false)
  const leaveAfterExit = useRef<(() => void) | null>(null)
  const [leave, setLeave] = useState<(() => void) | null>(null)
  const dirty =
    files.length > 0 ||
    JSON.stringify(fields) !== JSON.stringify(initial) ||
    Boolean(pending)
  useEffect(() => {
    const next = files.map((file) => URL.createObjectURL(file))
    setUrls(next)
    return () => next.forEach((url) => URL.revokeObjectURL(url))
  }, [files])
  const requestLeave = useCallback(
    (next: () => void) => {
      if (submitting.current || created) return
      if (dirty) setLeave(() => next)
      else next()
    },
    [dirty, created]
  )
  const previewPresence = useCallback((active: boolean) => {
    if (!active) setPreviewOpen(false)
  }, [])
  useEffect(() => {
    onGuardChange?.(requestLeave)
    return () => onGuardChange?.(null)
  }, [onGuardChange, requestLeave])
  let input: ReturnType<typeof validateBuilder> | null = null
  let validation = ''
  try {
    input = validateBuilder(fields, files, listing)
  } catch (reason) {
    validation = message(reason)
  }
  const disabled = !input || Boolean(photoError) || busy || !seller
  const change = (name: keyof ListingFields, value: string) => {
    setFields((current) =>
      name === 'category'
        ? changeBuilderCategory(current, value)
        : { ...current, [name]: value }
    )
  }
  let price = 0
  try {
    price = parseListingPrice(fields.price)
  } catch {
    /* Empty preview starts at Free. */
  }
  const preview: Listing = {
    ...(listing ?? {
      id: 'local-preview',
      createdAt: '',
      updatedAt: '',
      status: 'available',
      publishedAt: null,
    }),
    ...fields,
    price,
    currency: 'CAD',
    category: fields.category as Listing['category'],
    subcategory: fields.subcategory as Listing['subcategory'],
    condition: fields.condition as Listing['condition'],
    photoUrls: listing?.photoUrls ?? urls,
    seller: listing?.seller ?? seller ?? { id: '', displayName: 'You' },
  }
  const complete = (saved: Listing) => {
    onGuardChange?.(null)
    window.dispatchEvent(new Event('marketplace-listings-changed'))
    if (onSaved) onSaved(saved)
    else window.location.assign('/home?section=my-listings')
  }
  async function save() {
    if (submitting.current || disabled || !input || created) return false
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      if (listing) {
        const saved = await updateListing(listing.id, {
          title: input.title,
          price: input.price,
          description: input.description,
          condition: input.condition ?? null,
          pickupArea: input.pickupArea,
        })
        if (leave) {
          leaveAfterExit.current = leave
          setLeave(null)
          onGuardChange?.(null)
          window.dispatchEvent(new Event('marketplace-listings-changed'))
        } else complete(saved)
      } else {
        const result = pending
          ? await continueListingPublication(pending.listingId)
          : await createPublishedListing(input, files)
        if (result.state === 'published') {
          setCreated(result.listing)
          return true
        }
        setPending(result)
        setError(
          `${result.error} Continue publication to retry this same listing.`
        )
      }
    } catch (reason) {
      setError(message(reason))
    } finally {
      submitting.current = false
      setBusy(false)
    }
    return false
  }
  async function discard() {
    if (!leave || submitting.current) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      if (pending) {
        const state = await reconcileListingPublication(pending.listingId)
        if (state.state === 'published') {
          complete(state.listing)
          return
        }
        if (state.state === 'unknown')
          throw new Error(
            'Publication is still unknown. Continue publication before leaving.'
          )
        await abandonListing(pending.listingId)
      }
      leaveAfterExit.current = leave
      setLeave(null)
      onGuardChange?.(null)
    } catch (reason) {
      setError(message(reason))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const previewProps = {
    title: price === 0 ? 'Free' : formatListingPrice(price),
    expandedTitle: fields.title || 'Your listing',
    media: preview.photoUrls.length ? (
      <ListingMedia
        images={preview.photoUrls}
        alt={fields.title || 'Listing photo'}
        activeIndex={photoIndex}
        onIndexChange={setPhotoIndex}
      />
    ) : (
      <span className={styles.photoPlaceholder}>Add photos to preview</span>
    ),
    children: <ListingDetails listing={preview} />,
  }
  if (listing?.status === 'sold') return <p>Sold listings are read-only.</p>
  return (
    <div
      ref={builderRef}
      className={styles.builder}
      data-listing-builder={listing ? 'edit' : 'create'}
    >
      <form
        className={styles.form}
        data-photo-count={files.length}
        aria-label={listing ? 'Edit listing' : 'Create listing'}
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault()
          if (listing) save()
        }}
      >
        <fieldset disabled={busy || Boolean(pending)}>
          <legend className={styles.srOnly}>Listing details</legend>
          <div className={styles.field}>
            <span>Photos</span>
            {!listing && (
              <FileDrop
                accept="image/jpeg,image/png,image/webp"
                inputRef={fileInputRef}
                files={files}
                showFiles={false}
                disabled={busy || Boolean(pending)}
                onFiles={selectPhotos}
              />
            )}
            <p data-photo-requirements={true}>
              {listing
                ? 'Photos cannot be changed after publishing.'
                : '1-6 photos. JPEG, PNG or WebP. Maximum 3 MB each.'}
            </p>
            {listing ? (
              <div ref={photosRef} className={styles.photos}>
                {listing.photoUrls.map((url, index) => (
                  <img key={url} src={url} alt={`Photo ${index + 1}`} />
                ))}
              </div>
            ) : (
              <div ref={photosRef} data-selected-photos={true}>
                <div className={uploaderStyles.action}>
                  <AccessibleAction
                    items={photoCards}
                    activeIndex={photoIndex}
                    maxVisible={6}
                  />
                </div>
                {urls.length > 0 && (
                  <div className={uploaderStyles.controls}>
                    <WorkButton
                      appearance="pagination"
                      aria-label="Previous selected photo"
                      disabled={photoIndex === 0}
                      onClick={() => setPhotoIndex((current) => current - 1)}
                    >
                      <ArrowLeft size={18} aria-hidden={true} />
                    </WorkButton>
                    <CardAction
                      onClick={() => {
                        setFiles((current) =>
                          current.filter((_, index) => index !== photoIndex)
                        )
                        setPhotoIndex((current) =>
                          Math.min(current, Math.max(0, files.length - 2))
                        )
                        setPhotoError('')
                      }}
                    >
                      Discard
                    </CardAction>
                    <WorkButton
                      appearance="pagination"
                      aria-label="Next selected photo"
                      disabled={photoIndex >= files.length - 1}
                      onClick={() => setPhotoIndex((current) => current + 1)}
                    >
                      <ArrowRight size={18} aria-hidden={true} />
                    </WorkButton>
                  </div>
                )}
              </div>
            )}
            {photoError && <p role="alert">{photoError}</p>}
          </div>
          <label className={styles.field}>
            Title
            <input
              name="title"
              maxLength={listingLimits.title}
              value={fields.title}
              onChange={(event) => change('title', event.target.value)}
            />
          </label>
          <label className={styles.field}>
            Price (CA$)
            <input
              name="price"
              inputMode="decimal"
              value={fields.price}
              onChange={(event) => change('price', event.target.value)}
            />
            <span>Use 0 for Free.</span>
          </label>
          {listing ? (
            <div className={styles.field}>
              <span>Category</span>
              <p>{listing.category}</p>
              <span>Subcategory</span>
              <p>{listing.subcategory}</p>
              <p>Category cannot be changed after publishing.</p>
            </div>
          ) : (
            <>
              <div className={styles.field}>
                <span>Category</span>
                <GlideSelect
                  ariaLabel="Category"
                  size="lg"
                  surfaceColor="#2a2134"
                  highlightColor="#443451"
                  value={fields.category}
                  disabled={busy || Boolean(pending)}
                  options={[
                    { value: '', label: 'Choose a category' },
                    ...listingCategories,
                  ]}
                  onChange={(value: string) => change('category', value)}
                />
              </div>
              <div className={styles.field}>
                <span>Subcategory</span>
                <GlideSelect
                  key={fields.category}
                  ariaLabel="Subcategory"
                  size="lg"
                  surfaceColor="#2a2134"
                  highlightColor="#443451"
                  value={fields.subcategory}
                  disabled={!fields.category || busy || Boolean(pending)}
                  options={[
                    { value: '', label: 'Choose a subcategory' },
                    ...marketSubcategoryOptions(fields.category),
                  ]}
                  onChange={(value: string) => change('subcategory', value)}
                />
              </div>
            </>
          )}
          <div className={styles.field}>
            <span>Condition</span>
            <GlideSelect
              ariaLabel="Condition"
              size="lg"
              surfaceColor="#2a2134"
              highlightColor="#443451"
              value={fields.condition}
              disabled={busy || Boolean(pending)}
              options={[
                { value: '', label: 'Choose a condition' },
                ...listingConditions.map((item) => ({
                  ...item,
                  label: item.value === 'like-new' ? 'Like new' : item.label,
                })),
              ]}
              onChange={(value: string) => change('condition', value)}
            />
          </div>
          <div className={styles.field}>
            <span>Place</span>
            <GlideSelect
              ariaLabel="Place"
              size="lg"
              surfaceColor="#2a2134"
              highlightColor="#443451"
              value={fields.pickupArea}
              disabled={busy || Boolean(pending)}
              options={[
                { value: '', label: 'Choose a place' },
                ...marketLocations.map((place) => ({
                  value: place,
                  label: place,
                })),
              ]}
              onChange={(value: string) => change('pickupArea', value)}
            />
          </div>
          <label className={styles.field}>
            Description
            <textarea
              name="description"
              rows={5}
              maxLength={listingLimits.description}
              value={fields.description}
              onChange={(event) => change('description', event.target.value)}
            />
          </label>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {!error && validation && <p className={styles.hint}>{validation}</p>}
        <div className={!listing ? styles.createFooter : undefined}>
          <ActionRow mobileThree={!listing}>
            <CardAction
              disabled={busy}
              onClick={() =>
                requestLeave(
                  onCancel ??
                    (() => window.location.assign('/home?section=my-listings'))
                )
              }
            >
              Cancel
            </CardAction>

            <DynamicAction
              className={!listing ? styles.createPreviewAction : undefined}
              variant={listing ? 'blue' : 'dark-blue'}
              footer={true}
              disabled={busy}
              onClick={() => {
                const rect = photosRef.current
                  ?.querySelector('img')
                  ?.getBoundingClientRect()
                if (rect)
                  setPreviewRect({
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                  })
                setPreviewOpen(true)
              }}
            >
              Preview
            </DynamicAction>
            {!listing && (
              <span className={successStyles.createAction}>
                <StatefulButton
                  key={createGeneration}
                  className={successStyles.createButton}
                  disabled={disabled || Boolean(created)}
                  resetAfter={2000}
                  successText="Created"
                  errorText="Retry"
                  onStateChange={createStateChanged}
                  onClick={async () => {
                    await new Promise<void>((resolve) => {
                      createBuffer.current = setTimeout(resolve, 200)
                    })
                    if (!(await save()))
                      throw new Error('Publication was not confirmed.')
                  }}
                >
                  Create
                </StatefulButton>
              </span>
            )}
          </ActionRow>
        </div>
        {listing && (
          <div className={styles.submit}>
            <CardAction type="submit" disabled={disabled}>
              {busy ? 'Saving...' : 'Save changes'}
            </CardAction>
          </div>
        )}
      </form>
      <aside className={styles.previewColumn}>
        <ExpandedCardPreview
          {...previewProps}
          className={styles.inlinePreview}
        />
      </aside>
      {previewOpen && (
        <div className={styles.previewSource} style={previewRect}>
          <ExpandableCard
            {...previewProps}
            interactiveMedia={preview.photoUrls.length > 1}
            className={styles.previewTrigger}
            openOnMount={true}
            onOverlayActiveChange={previewPresence}
          />
        </div>
      )}
      {created && successReady && (
        <CreateSuccess
          workspace={builderRef.current}
          onReset={() => {
            setCreateGeneration((current) => current + 1)
            setFields(initialListingFields())
            setFiles([])
            setUrls([])
            setPhotoIndex(0)
            setPending(null)
            setError('')
            setPhotoError('')
            setPreviewOpen(false)
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
          onDone={(choice) => {
            if (choice === 'back') complete(created)
            else {
              setCreated(null)
              setSuccessReady(false)
            }
          }}
        />
      )}
      <AnimatePresence
        onExitComplete={() => {
          const destination = leaveAfterExit.current
          leaveAfterExit.current = null
          destination?.()
        }}
      >
        {leave && (
          <ListingConfirmation
            title={listing ? 'Discard changes?' : 'Discard this listing?'}
            confirm="Discard"
            busy={busy}
            error={error}
            saveDisabled={disabled}
            onCancel={() => setLeave(null)}
            onConfirm={() => discard()}
            onSave={listing ? () => save() : undefined}
          >
            {listing
              ? 'Your unsaved changes will be lost.'
              : 'Your unsaved listing information will be lost.'}
          </ListingConfirmation>
        )}
      </AnimatePresence>
    </div>
  )
}
