/* eslint @next/next/no-img-element: off -- Local object URLs and immutable listing photos. */
import ShiningButton from '@/components/animata/button/shining-button'
import { AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CreditCard,
  Landmark,
} from 'lucide-react'
import type { SetStateAction } from 'react'
/* eslint jsx-a11y/no-onchange: off -- Form controls update only the local preview. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FormProvider, useForm, useWatch } from 'react-hook-form'

import { AccessibleAction } from '@/components/accessible-action'
import WorkButton from '@/components/animata/button/work-button'
import MultiStepForm from '@/components/multi-step-form'
import wizard from '@/components/multi-step-form.module.css'
import GlideSelect from '@/components/ui/GlideSelect'
import { ActionRow } from '@/components/ui/action-row'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ExpandableCard,
  ExpandedCardPreview,
} from '@/components/velora/expandable-card'
import { FileDrop } from '@/components/velora/file-drop'
import {
  changeBuilderCategory,
  initialListingFields,
  validateBuilder,
} from '@/lib/listing-builder'
import type { ListingFields } from '@/lib/listing-builder'
import { listingFulfillmentEnabled } from '@/lib/listing-fulfillment'
import { validateListingImage } from '@/lib/listing-images'
import { listingCategories, listingConditions } from '@/lib/listing-metadata'
import {
  createPublishedListing,
  shopPublicationOperations,
  continueListingPublication,
  reconcileListingPublication,
} from '@/lib/listing-publication'
import type { PublicationResult } from '@/lib/listing-publication'
import { listingLimits } from '@/lib/listing-validation'
import { listingWizardModes } from '@/lib/listing-wizard'
import { abandonListing, updateListing } from '@/lib/listings-api'
import {
  isMarketCategory,
  isMarketPair,
  marketSubcategoryOptions,
} from '@/lib/market-taxonomy'
import { parseMeetingLocation } from '@/lib/meeting-location'
import { parseOfferAmount } from '@/lib/offer-amount'
import type { Listing } from '@/types/listing'
import { formatListingPrice } from '@/utils/format-listing-price'
import { parseListingPrice } from '@/utils/parse-listing-price'

import { CardAction } from './card-actions'
import { CreateSuccess } from './create-success'
import { ListingConfirmation } from './listing-confirmation'
import { ListingMedia } from './listing-media'
import uploaderStyles from './listing-uploader.module.css'
import styles from './listing-workspace.module.css'
import { useMarketplaceSession } from './marketplace-session'
import { MeetingLocationInput } from './meeting-location-input'
import { ListingDetails } from './published-listing-card'
import { PublishedListingDetails } from './published-listing-details'

export type ListingLeaveGuard = (leave: () => void) => void
export type ListingFormProps = {
  presentation?: 'page' | 'sheet'
  createLabel?: string
  mode?: 'resale' | 'shop'
  /** Component-test/demo presentation only. Never enables Shop publication. */
  previewOnly?: boolean
  listing?: Listing
  onCancel?: () => void
  onSaved?: (listing: Listing) => void
  onGuardChange?: (guard: ListingLeaveGuard | null) => void
}
const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : 'Unable to save. Please try again.'

// eslint-disable-next-line complexity -- Create/edit share the same controlled form and publication boundary.
export function ListingForm({
  presentation = 'page',
  createLabel = 'Create Resale',
  mode = 'resale',
  previewOnly = false,
  listing,
  onCancel,
  onSaved,
  onGuardChange,
}: ListingFormProps) {
  const {
    seller,
    loading: sessionLoading,
    error: sessionError,
  } = useMarketplaceSession()
  const channel = listing?.listingChannel ?? mode
  const initial = useMemo(
    () => initialListingFields(listing, channel),
    [channel, listing]
  )
  const form = useForm<ListingFields>({ defaultValues: initial })
  const fields = useWatch({ control: form.control }) as ListingFields
  const setFields = useCallback(
    (action: SetStateAction<ListingFields>) => {
      const current = form.getValues()
      const next = typeof action === 'function' ? action(current) : action
      ;(Object.keys(next) as Array<keyof ListingFields>).forEach((name) => {
        if (next[name] !== current[name])
          form.setValue(name, next[name], { shouldDirty: true })
      })
    },
    [form]
  )
  const wizardPresentation = !listing || presentation === 'sheet'
  const resaleUpload =
    !listing && channel === 'resale' && presentation === 'sheet'
  const shopCreationIllustrations =
    !listing && channel === 'shop' && presentation === 'sheet'
  const context = {
    ...listingWizardModes[channel],
    heading:
      channel === 'resale' ? createLabel : listingWizardModes.shop.heading,
  }
  const shopCreationId = useRef<string | null>(null)
  const [stepError, setStepError] = useState('')
  // Shop demo UX only; do NOT pass this value to create/update listing APIs.
  const [shopPreviewQuantity, setShopPreviewQuantity] = useState(1)
  form.register('title', {
    validate: (value) =>
      (Boolean(value.trim()) && value.trim().length <= listingLimits.title) ||
      `Title is required and must be at most ${listingLimits.title} characters.`,
  })
  form.register('price', {
    validate: (value) => {
      try {
        parseListingPrice(value)
        return true
      } catch (reason) {
        return message(reason)
      }
    },
  })
  form.register('condition', {
    validate: (value) =>
      listingConditions.some((item) => item.value === value) ||
      'Choose a condition.',
  })
  form.register('category', {
    validate: (value) =>
      isMarketCategory(value) || 'Choose a marketplace category.',
  })
  form.register('subcategory', {
    validate: (value) =>
      !value ||
      isMarketPair(form.getValues('category'), value) ||
      'Choose a marketplace subcategory.',
  })
  form.register('description', {
    validate: (value) =>
      value.length <= listingLimits.description ||
      `Description must be at most ${listingLimits.description} characters.`,
  })
  form.register('meetingLocation', {
    validate: (value) => {
      if (form.getValues('preferredFulfillment') === 'DELIVERY') return true
      try {
        const location = parseMeetingLocation(value)
        return (
          Boolean(location?.provider && location.placeId) ||
          'Choose a suggested Google Place for the meeting.'
        )
      } catch (reason) {
        return message(reason)
      }
    },
  })
  form.register('meetingArea', {
    validate: (value) =>
      form.getValues('preferredFulfillment') === 'DELIVERY' ||
      value === 'ON_CAMPUS' ||
      value === 'OTHER' ||
      'Choose an on-campus or other meeting area.',
  })
  form.register('meetingLocationDetail', {
    validate: (value) =>
      value.length <= listingLimits.meetingLocationDetail ||
      `Location detail must be at most ${listingLimits.meetingLocationDetail} characters.`,
  })
  form.register('estimatedDeliveryFee', {
    validate: (value) =>
      form.getValues('preferredFulfillment') !== 'DELIVERY' ||
      parseOfferAmount(value.trim() || '0', true) !== null ||
      'Enter a non-negative estimated delivery fee with up to two decimal places.',
  })
  form.register('preferredPaymentMode', {
    validate: (value) =>
      (['external', 'in_person', 'interac_etransfer', 'uu_pay'].includes(
        value
      ) &&
        (form.getValues('preferredFulfillment') !== 'DELIVERY' ||
          value === 'uu_pay' ||
          value === 'interac_etransfer')) ||
      'Delivery supports Interac e-Transfer or UU Pay.',
  })
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
  const shopScrollbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (shopScrollbarTimer.current !== null)
        clearTimeout(shopScrollbarTimer.current)
    }
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
        : {
            ...current,
            [name]: value,
            ...(name === 'preferredFulfillment' && value === 'DELIVERY'
              ? { preferredPaymentMode: 'uu_pay' as const }
              : {}),
          }
    )
  }
  let price = 0
  try {
    price = parseListingPrice(fields.price)
  } catch {
    /* Empty preview starts at Free. */
  }
  const { subcategory: previewSubcategory, ...previewFields } = fields
  void previewSubcategory
  const preview: Listing = {
    ...(listing ?? {
      listingChannel: channel,
      id: 'local-preview',
      createdAt: '',
      updatedAt: '',
      status: 'available',
      publishedAt: null,
    }),
    ...previewFields,
    estimatedDeliveryFeeCents:
      parseOfferAmount(fields.estimatedDeliveryFee.trim() || '0', true) ?? 0,
    price,
    currency: 'CAD',
    category: fields.category as Listing['category'],
    ...(fields.subcategory
      ? { subcategory: fields.subcategory as Listing['subcategory'] }
      : {}),
    condition: fields.condition as Listing['condition'],
    photoUrls: listing?.photoUrls ?? urls,
    seller: listing?.seller ?? seller ?? { id: '', displayName: 'You' },
  }
  const complete = (saved: Listing) => {
    shopCreationId.current = null
    setPending(null)
    onGuardChange?.(null)
    window.dispatchEvent(new Event('marketplace-listings-changed'))
    if (onSaved) onSaved(saved)
    else window.location.assign(context.destination)
  }
  async function save() {
    if (previewOnly) return false
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
          preferredPaymentMode: input.preferredPaymentMode,
          preferredFulfillment: input.preferredFulfillment,
          meetingArea: input.meetingArea,
          meetingLocation: input.meetingLocation,
          meetingLocationDetail: input.meetingLocationDetail,
          estimatedDeliveryFeeCents: input.estimatedDeliveryFeeCents,
        })
        if (leave) {
          leaveAfterExit.current = leave
          setLeave(null)
          onGuardChange?.(null)
          window.dispatchEvent(new Event('marketplace-listings-changed'))
        } else complete(saved)
        return true
      }
      if (channel === 'shop' && !shopCreationId.current)
        shopCreationId.current = crypto.randomUUID()
      let result: PublicationResult
      if (channel === 'shop')
        result = await createPublishedListing(
          input,
          files,
          shopPublicationOperations(shopCreationId.current!)
        )
      else if (pending)
        result = await continueListingPublication(
          pending.listingId,
          undefined,
          files
        )
      else result = await createPublishedListing(input, files)
      if (result.state === 'published') {
        shopCreationId.current = null
        setPending(null)
        if (presentation === 'sheet') complete(result.listing)
        else {
          setCreated(result.listing)
          setSuccessReady(true)
        }
        return true
      }
      setPending(result)
      setError(
        `${result.error} Continue publication to retry this same listing.`
      )
    } catch (reason) {
      if (!listing && channel === 'shop' && shopCreationId.current) {
        const state = await reconcileListingPublication(
          shopCreationId.current,
          undefined,
          reason
        )
        if (state.state === 'published') {
          complete(state.listing)
          return true
        }
        setPending(state)
      }
      setError(message(reason))
    } finally {
      submitting.current = false
      setBusy(false)
    }
    return false
  }
  async function discard() {
    if (!leave || submitting.current) return
    let publicationCompleted = false
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      if (pending) {
        const state = await reconcileListingPublication(pending.listingId)
        if (state.state === 'published') {
          publicationCompleted = true
          complete(state.listing)
          return
        }
        await abandonListing(pending.listingId)
      }
    } catch (reason) {
      // No form persistence: Discard leaves even if remote cleanup is unconfirmed.
      // eslint-disable-next-line no-console -- Run/listing identifier only, no fields or files.
      console.warn('Listing draft cleanup unconfirmed after Discard', {
        listingId: pending?.listingId,
      })
    } finally {
      if (!listing) {
        form.reset(initial)
        setFiles([])
        setUrls([])
        setPending(null)
        shopCreationId.current = null
        setError('')
        setPhotoError('')
        setCreated(null)
        setPhotoIndex(0)
      }
      if (!publicationCompleted) leaveAfterExit.current = leave
      setLeave(null)
      onGuardChange?.(null)
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
  const photosField = (
    <>
      <div
        className={`${styles.field} ${
          wizardPresentation ? wizard.photos : ''
        } ${
          resaleUpload || shopCreationIllustrations ? styles.shopPhotoStep : ''
        } ${resaleUpload ? styles.resaleLayoutPhotos : ''}`}
      >
        <div
          className={`${wizard.photoUpload} ${
            resaleUpload || shopCreationIllustrations
              ? styles.shopPhotoUpload
              : ''
          }`}
          data-resale-photo-upload={resaleUpload || undefined}
        >
          <span>Photos</span>
          {!listing && (
            <FileDrop
              stopFileDialogCancelPropagation={
                shopCreationIllustrations || resaleUpload
              }
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
          {/* UU Resale Create V4 — delete Step 1 decorative phone illustration
          render. */}
        </div>
        {listing ? (
          <div ref={photosRef} className={styles.photos}>
            {listing.photoUrls.map((url, index) => (
              <img key={url} src={url} alt={`Photo ${index + 1}`} />
            ))}
          </div>
        ) : (
          <div
            ref={photosRef}
            data-selected-photos={true}
            className={
              shopCreationIllustrations || resaleUpload
                ? styles.shopPhotoGallery
                : undefined
            }
          >
            {shopCreationIllustrations || resaleUpload ? (
              <div
                className={styles.shopPhotoCard}
                aria-label="Product photo album"
              >
                <div className={uploaderStyles.action}>
                  <AccessibleAction
                    items={photoCards}
                    activeIndex={photoIndex}
                    maxVisible={6}
                    cardWidth={300}
                    cardHeight={300}
                  />
                </div>
                {urls.length > 0 && (
                  <>
                    <button
                      type="button"
                      className={`${styles.shopPhotoNav} ${styles.shopPhotoNavPrev}`}
                      aria-label="Previous product photo"
                      disabled={photoIndex === 0}
                      onClick={() =>
                        setPhotoIndex((current) => Math.max(0, current - 1))
                      }
                    >
                      <ArrowLeft size={18} aria-hidden={true} />
                    </button>
                    <button
                      type="button"
                      className={`${styles.shopPhotoNav} ${styles.shopPhotoNavNext}`}
                      aria-label="Next product photo"
                      disabled={photoIndex >= urls.length - 1}
                      onClick={() =>
                        setPhotoIndex((current) =>
                          Math.min(urls.length - 1, current + 1)
                        )
                      }
                    >
                      <ArrowRight size={18} aria-hidden={true} />
                    </button>
                    <span className={styles.shopPhotoCounter}>
                      {photoIndex + 1} / {urls.length}
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div className={uploaderStyles.action}>
                <AccessibleAction
                  items={photoCards}
                  activeIndex={photoIndex}
                  maxVisible={6}
                />
              </div>
            )}
            {urls.length > 0 && !shopCreationIllustrations && !resaleUpload && (
              <div className={uploaderStyles.controls}>
                <WorkButton
                  appearance="pagination"
                  aria-label="Previous selected photo"
                  disabled={photoIndex === 0}
                  onClick={() => setPhotoIndex((current) => current - 1)}
                >
                  <ArrowLeft size={18} aria-hidden={true} />
                </WorkButton>
                <ShiningButton
                  variant="red"
                  showArrow={false}
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
                </ShiningButton>
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
            {(shopCreationIllustrations || resaleUpload) && (
              <div
                className={styles.shopPhotoThumbnails}
                aria-label="Selected product photos, six slots"
              >
                {Array.from({ length: 6 }, (_, index) => {
                  const url = urls[index]
                  return (
                    <div
                      className={styles.shopPhotoThumb}
                      key={`shop-photo-slot-${index}`}
                    >
                      {url ? (
                        <>
                          <div
                            className={styles.shopPhotoThumbImage}
                            data-active-photo={
                              photoIndex === index || undefined
                            }
                            aria-label={`Product photo ${index + 1}`}
                            role="img"
                          >
                            <img src={url} alt="" loading="lazy" />
                          </div>
                          <button
                            type="button"
                            className={styles.shopPhotoRemove}
                            aria-label={`Remove product photo ${index + 1}`}
                            onClick={() => {
                              setFiles((current) =>
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index
                                )
                              )
                              setPhotoIndex((current) =>
                                Math.max(
                                  0,
                                  Math.min(
                                    current > index ? current - 1 : current,
                                    files.length - 2
                                  )
                                )
                              )
                              setPhotoError('')
                            }}
                          >
                            <span aria-hidden="true">×</span>
                          </button>
                        </>
                      ) : (
                        <div
                          className={styles.shopPhotoSlotEmpty}
                          aria-hidden="true"
                        >
                          <span>+</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {photoError && <p role="alert">{photoError}</p>}
      </div>
    </>
  )
  const titleField = (
    <>
      <label className={styles.field}>
        Title
        <input
          {...form.register('title')}
          aria-invalid={Boolean(form.formState.errors.title)}
          name="title"
          maxLength={listingLimits.title}
          value={fields.title}
          onChange={(event) => change('title', event.target.value)}
        />
      </label>
    </>
  )
  const priceField = (
    <>
      <label className={styles.field}>
        Price (CA$)
        <input
          {...form.register('price')}
          aria-invalid={Boolean(form.formState.errors.price)}
          name="price"
          inputMode="decimal"
          value={fields.price}
          onChange={(event) => change('price', event.target.value)}
        />
        <span>Use 0 for Free.</span>
      </label>
    </>
  )
  const categoryField = (
    <>
      {listing ? (
        <div className={styles.field}>
          <span>Category</span>
          <p>{listing.category}</p>
          <span>Subcategory</span>
          {listing.subcategory && <p>{listing.subcategory}</p>}
          <p>Category cannot be changed after publishing.</p>
        </div>
      ) : (
        <>
          <div className={styles.field}>
            <span>Category</span>
            <GlideSelect
              overlay={wizardPresentation}
              ariaLabel="Category"
              size="lg"
              radius={999}
              menuRadius={20}
              optionRadius={12}
              menuSurfaceColor="#201a29"
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
              overlay={wizardPresentation}
              key={fields.category}
              ariaLabel="Subcategory"
              size="lg"
              radius={999}
              menuRadius={20}
              optionRadius={12}
              menuSurfaceColor="#201a29"
              surfaceColor="#2a2134"
              highlightColor="#443451"
              value={fields.subcategory}
              disabled={!fields.category || busy || Boolean(pending)}
              options={[
                { value: '', label: 'No subcategory' },
                ...marketSubcategoryOptions(fields.category),
              ]}
              onChange={(value: string) => change('subcategory', value)}
            />
          </div>
        </>
      )}
    </>
  )
  const conditionField = (
    <>
      <div className={styles.field}>
        <span>Condition</span>
        <GlideSelect
          overlay={wizardPresentation}
          ariaLabel="Condition"
          size="lg"
          radius={999}
          menuRadius={20}
          optionRadius={12}
          menuSurfaceColor="#201a29"
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
    </>
  )
  const fulfillmentField = (
    <>
      {(!listing || listingFulfillmentEnabled()) && (
        <div className={styles.fulfillmentColumn}>
          <div className={styles.field}>
            <span>Preferred fulfillment</span>
            <SegmentedControl
              ariaLabel="Preferred fulfillment"
              value={fields.preferredFulfillment}
              disabled={busy || Boolean(pending)}
              items={[
                { value: 'ON_CAMPUS', label: 'Meeting' },
                { value: 'DELIVERY', label: 'Delivery' },
              ]}
              onChange={(value) => change('preferredFulfillment', value)}
              className={styles.fulfillmentSegment}
            />
            <small>Buyers may propose another fulfillment mode.</small>
          </div>
          {fields.preferredFulfillment === 'ON_CAMPUS' && (
            <>
              <div className={styles.field}>
                <span>Meeting area</span>
                <SegmentedControl
                  ariaLabel="Meeting area"
                  value={fields.meetingArea}
                  disabled={busy || Boolean(pending)}
                  items={[
                    { value: 'ON_CAMPUS', label: 'On campus' },
                    { value: 'OTHER', label: 'Other' },
                  ]}
                  onChange={(value) => change('meetingArea', value)}
                  className={styles.fulfillmentSegment}
                />
              </div>
            </>
          )}
          {fields.preferredFulfillment === 'DELIVERY' && (
            <label className={styles.field}>
              Estimated delivery fee (CA$)
              <input
                {...form.register('estimatedDeliveryFee')}
                aria-invalid={Boolean(
                  form.formState.errors.estimatedDeliveryFee
                )}
                name="estimatedDeliveryFee"
                inputMode="decimal"
                placeholder="0.00"
                value={fields.estimatedDeliveryFee}
                onChange={(event) =>
                  change('estimatedDeliveryFee', event.target.value)
                }
              />
            </label>
          )}
        </div>
      )}
    </>
  )
  const meetingLocationField =
    fields.preferredFulfillment === 'ON_CAMPUS' ? (
      <MeetingLocationInput
        required={true}
        meetingArea={fields.meetingArea}
        label="Place"
        helper="Choose a Google Place from the suggestions."
        value={fields.meetingLocation?.label || ''}
        selected={
          fields.meetingLocation?.provider && fields.meetingLocation.placeId
            ? {
                provider: 'google',
                placeId: fields.meetingLocation.placeId,
              }
            : null
        }
        disabled={busy || Boolean(pending)}
        error={
          form.formState.errors.meetingLocation?.message as string | undefined
        }
        onChange={(value) =>
          setFields((current) => ({
            ...current,
            meetingLocation: value.trim() ? { label: value } : null,
          }))
        }
        onSelect={(place) =>
          setFields((current) => ({
            ...current,
            meetingLocation: place
              ? {
                  label:
                    place.displayName ||
                    place.formattedAddress ||
                    current.meetingLocation?.label ||
                    '',
                  provider: 'google',
                  placeId: place.placeId,
                }
              : null,
          }))
        }
      />
    ) : null
  const deliveryDestinationField =
    fields.preferredFulfillment === 'DELIVERY' ? (
      <>
        <label className={styles.field}>
          Delivery destination
          <input
            disabled={true}
            value="Confirmed when arranging the transaction"
            aria-describedby="delivery-destination-help"
            readOnly={true}
          />
        </label>
        <label className={styles.field}>
          Destination details
          <textarea disabled={true} rows={3} value="" readOnly={true} />
        </label>
        <p id="delivery-destination-help" className={styles.deliveryHint}>
          Delivery address is confirmed when arranging the transaction.
        </p>
      </>
    ) : null
  const locationDetailField =
    fields.preferredFulfillment === 'ON_CAMPUS' ? (
      <label className={styles.field}>
        Location detail
        <textarea
          {...form.register('meetingLocationDetail')}
          name="meetingLocationDetail"
          maxLength={listingLimits.meetingLocationDetail}
          rows={3}
          placeholder="Entrance, floor, room, or meeting instructions (optional)"
          value={fields.meetingLocationDetail}
          onChange={(event) =>
            change('meetingLocationDetail', event.target.value)
          }
        />
      </label>
    ) : null
  const descriptionField = (
    <label
      className={`${styles.field} ${
        shopCreationIllustrations ? styles.shopDescriptionField : ''
      }`}
    >
      Description
      <textarea
        name="description"
        rows={5}
        maxLength={listingLimits.description}
        value={fields.description}
        onChange={(event) => change('description', event.target.value)}
      />
    </label>
  )
  const stepFields: Array<Array<keyof ListingFields>> = [
    [],
    ['title', 'price', 'condition', 'category', 'subcategory'],
    [
      'meetingArea',
      'meetingLocation',
      'meetingLocationDetail',
      'estimatedDeliveryFee',
    ],
    ['preferredPaymentMode'],
  ]
  const validateStep = async (step: number) => {
    setStepError('')
    if (step === 0) {
      if (listing) return true
      try {
        if (files.length < 1 || files.length > listingLimits.photos)
          throw new Error('Choose 1-6 photos.')
        files.forEach(validateListingImage)
        if (photoError) throw new Error(photoError)
        return true
      } catch (reason) {
        setStepError(message(reason))
        return false
      }
    }

    const valid = await form.trigger(stepFields[step], { shouldFocus: true })

    if (!valid) {
      const errors = form.formState.errors
      const first = stepFields[step]
        .map((key) => form.getFieldState(key).error?.message)
        .find(Boolean)

      setStepError(
        String(first || errors.root?.message || 'Check the required fields.')
      )
      return false
    }

    if (
      step === 2 &&
      fields.preferredFulfillment !== 'DELIVERY' &&
      (fields.meetingArea === 'ON_CAMPUS' || fields.meetingArea === 'OTHER')
    ) {
      const placeId = fields.meetingLocation?.placeId

      if (fields.meetingLocation?.provider !== 'google' || !placeId) {
        const error = 'Choose a suggested Google Place.'
        form.setError('meetingLocation', {
          type: 'manual',
          message: error,
        })
        setStepError(error)
        return false
      }

      try {
        const response = await fetch('/api/places/validate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-marketplace-request': '1',
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            placeId,
            meetingArea: fields.meetingArea,
            sessionToken: crypto.randomUUID(),
          }),
        })

        if (!response.ok) {
          throw new Error('Location validation unavailable.')
        }

        const result: { valid?: boolean } = await response.json()

        if (result.valid !== true) {
          const error =
            fields.meetingArea === 'ON_CAMPUS'
              ? 'This location is outside the Western University campus. Choose an on-campus location or select Other.'
              : 'This location is within the Western University campus. Choose an off-campus location or select On campus.'

          form.setError('meetingLocation', {
            type: 'manual',
            message: error,
          })
          setStepError(error)
          return false
        }

        form.clearErrors('meetingLocation')
      } catch {
        const error = 'Unable to verify this location right now. Please retry.'

        form.setError('meetingLocation', {
          type: 'manual',
          message: error,
        })
        setStepError(error)
        return false
      }
    }

    return true
  }

  const paymentOptions: Array<{
    value: ListingFields['preferredPaymentMode']
    title: string
    description: string
    Icon: typeof Banknote
    disabled?: boolean
  }> = [
    {
      value: 'in_person',
      title: 'Cash / In-Person',
      description: 'Pay in cash or confirm payment together when you meet.',
      Icon: Banknote,
      disabled: fields.preferredFulfillment === 'DELIVERY',
    },
    {
      value: 'interac_etransfer',
      title: 'Interac e-Transfer',
      description: 'Arrange an Interac e-Transfer directly with the buyer.',
      Icon: Landmark,
    },
    {
      value: 'uu_pay',
      title: 'UU Pay (Stripe)',
      description:
        'Payment is processed by Stripe when UU Pay is available for the exchange.',
      Icon: CreditCard,
    },
  ]
  const paymentField = (
    <div className={wizard.payment}>
      {paymentOptions.map(({ Icon, ...option }) => (
        <label key={option.value}>
          <span>
            {shopCreationIllustrations || resaleUpload ? (
              <img
                className={styles.shopPaymentIllustration}
                src={
                  option.value === 'in_person'
                    ? '/static/images/create-product/shop-payment-cash.png'
                    : option.value === 'interac_etransfer'
                    ? '/static/images/create-product/shop-payment-interac.png'
                    : '/static/images/create-product/shop-payment-stripe.png'
                }
                alt=""
                aria-hidden={true}
                width={52}
                height={52}
              />
            ) : (
              <Icon aria-hidden="true" size={20} />
            )}
            <span>
              <strong>{option.title}</strong>
              <p>
                {option.disabled
                  ? 'Unavailable for Delivery. Delivery requires UU Pay.'
                  : option.description}
              </p>
            </span>
          </span>
          <input
            type="radio"
            name="wizardPayment"
            value={option.value}
            checked={
              (fields.preferredPaymentMode === 'external'
                ? 'in_person'
                : fields.preferredPaymentMode) === option.value
            }
            disabled={Boolean(option.disabled) || busy || Boolean(pending)}
            onChange={() => change('preferredPaymentMode', option.value)}
          />
        </label>
      ))}
      <p className={wizard.notice}>
        This is your default preference. Buyers may propose another supported
        payment method. Creating a Listing does not charge anyone.
      </p>
      {(resaleUpload || shopCreationIllustrations) && (
        <img
          className={styles.resaleIllustrationPayment}
          src={
            shopCreationIllustrations
              ? '/static/images/create-product/shop-payment-method.png'
              : '/static/images/create-product/payment-method.png'
          }
          alt=""
          aria-hidden="true"
          loading="lazy"
        />
      )}
    </div>
  )
  const reviewField =
    (shopCreationIllustrations && previewOnly) || resaleUpload ? (
      <div
        className={`${styles.shopReview} ${
          resaleUpload ? styles.resaleLayoutReview : ''
        }`}
        data-review-channel={channel}
      >
        <section
          className={`${styles.shopReviewPhotos} ${styles.shopPhotoGallery}`}
          aria-label="Review product photos"
        >
          <div
            className={styles.shopPhotoCard}
            aria-label="Product photo album"
          >
            <div className={uploaderStyles.action}>
              <AccessibleAction
                items={photoCards}
                activeIndex={photoIndex}
                maxVisible={6}
              />
            </div>
            {urls.length > 0 && (
              <>
                <button
                  type="button"
                  className={`${styles.shopPhotoNav} ${styles.shopPhotoNavPrev}`}
                  aria-label="Previous review photo"
                  disabled={photoIndex === 0}
                  onClick={() =>
                    setPhotoIndex((current) => Math.max(0, current - 1))
                  }
                >
                  <ArrowLeft size={18} aria-hidden={true} />
                </button>
                <button
                  type="button"
                  className={`${styles.shopPhotoNav} ${styles.shopPhotoNavNext}`}
                  aria-label="Next review photo"
                  disabled={photoIndex >= urls.length - 1}
                  onClick={() =>
                    setPhotoIndex((current) =>
                      Math.min(urls.length - 1, current + 1)
                    )
                  }
                >
                  <ArrowRight size={18} aria-hidden={true} />
                </button>
                <span className={styles.shopPhotoCounter}>
                  {photoIndex + 1} / {urls.length}
                </span>
              </>
            )}
          </div>
          <div
            className={styles.shopPhotoThumbnails}
            aria-label="Product photo thumbnails"
          >
            {Array.from({ length: 6 }, (_, index) => {
              const url = urls[index]
              return (
                <div
                  className={styles.shopPhotoThumb}
                  key={`review-photo-slot-${index}`}
                >
                  {url ? (
                    <div
                      className={styles.shopPhotoThumbImage}
                      data-active-photo={photoIndex === index || undefined}
                      role="img"
                      aria-label={`Product photo ${index + 1}`}
                    >
                      <img src={url} alt="" loading="lazy" />
                    </div>
                  ) : (
                    <div
                      className={styles.shopPhotoSlotEmpty}
                      aria-hidden={true}
                    >
                      <span>+</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
        <section
          className={styles.shopReviewInfo}
          aria-label="Review product information"
        >
          <h3>
            {fields.title.trim() ||
              (resaleUpload ? 'Untitled listing' : 'Untitled product')}
          </h3>
          <strong className={styles.shopReviewPrice}>
            {price === 0 ? 'Free' : formatListingPrice(price)}
          </strong>
          <dl className={styles.shopReviewFacts}>
            {shopCreationIllustrations && (
              <div>
                <dt>Inventory</dt>
                <dd>{shopPreviewQuantity}</dd>
              </div>
            )}
            <div>
              <dt>Condition</dt>
              <dd>{fields.condition || 'Not selected'}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{fields.category || 'Not selected'}</dd>
            </div>
            <div>
              <dt>Subcategory</dt>
              <dd>{fields.subcategory || 'Not selected'}</dd>
            </div>
          </dl>
          <div className={styles.shopReviewDescription}>
            <h4>Description</h4>
            <p>{fields.description.trim() || 'No description entered'}</p>
          </div>
          <dl className={styles.shopReviewFacts}>
            <div>
              <dt>Fulfillment</dt>
              <dd>
                {fields.preferredFulfillment === 'DELIVERY'
                  ? 'Delivery'
                  : 'Meeting'}
              </dd>
            </div>
            {fields.preferredFulfillment === 'DELIVERY' ? (
              <>
                <div>
                  <dt>Delivery estimate</dt>
                  <dd>
                    {Number(fields.estimatedDeliveryFee || 0) === 0
                      ? 'Free'
                      : `CA$${fields.estimatedDeliveryFee}`}
                  </dd>
                </div>
                <div>
                  <dt>Destination</dt>
                  <dd>Confirmed when arranging the transaction</dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt>Meeting area</dt>
                  <dd>
                    {fields.meetingArea === 'ON_CAMPUS' ? 'On campus' : 'Other'}
                  </dd>
                </div>
                <div>
                  <dt>Place</dt>
                  <dd>{fields.meetingLocation?.label || 'Not selected'}</dd>
                </div>
                {!!fields.meetingLocationDetail.trim() && (
                  <div>
                    <dt>Location detail</dt>
                    <dd>{fields.meetingLocationDetail}</dd>
                  </div>
                )}
              </>
            )}
            <div>
              <dt>Payment</dt>
              <dd>
                {fields.preferredPaymentMode === 'uu_pay'
                  ? 'UU Pay (Stripe)'
                  : fields.preferredPaymentMode === 'interac_etransfer'
                  ? 'Interac e-Transfer'
                  : 'Cash / In-Person'}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    ) : (
      <div className={wizard.review} data-review-channel={channel}>
        <ExpandedCardPreview
          {...previewProps}
          className={`${styles.inlinePreview} ${wizard.reviewCard}`}
        >
          <PublishedListingDetails listing={preview} />
        </ExpandedCardPreview>
      </div>
    )
  let publishLabel: string = context.publish
  if (channel === 'resale') publishLabel = 'Confirm & Publish'
  if (listing) publishLabel = 'Save Changes'
  const publishAction = (
    <ShiningButton
      variant="purple"
      desktopAppearance
      loading={busy}
      disabled={disabled || Boolean(created) || previewOnly || busy}
      showArrow={true}
      onClick={async () => {
        await save()
      }}
    >
      {publishLabel}
    </ShiningButton>
  )
  const stepContents = [
    photosField,
    <>
      {titleField}
      {priceField}
      {shopCreationIllustrations && previewOnly && (
        <div className={styles.shopInventoryPreview}>
          <span>Inventory Quantity</span>
          <div
            className={styles.shopInventoryStepper}
            role="group"
            aria-label="Inventory Quantity"
          >
            <button
              type="button"
              aria-label="Decrease inventory quantity"
              disabled={shopPreviewQuantity <= 1}
              onClick={() =>
                setShopPreviewQuantity((value) => Math.max(1, value - 1))
              }
            >
              −
            </button>
            <output aria-live="polite">{shopPreviewQuantity}</output>
            <button
              type="button"
              aria-label="Increase inventory quantity"
              disabled={shopPreviewQuantity >= 9999}
              onClick={() =>
                setShopPreviewQuantity((value) => Math.min(9999, value + 1))
              }
            >
              +
            </button>
          </div>
        </div>
      )}
      {conditionField}
      {categoryField}
      {descriptionField}
      {(resaleUpload || shopCreationIllustrations) && (
        <img
          className={styles.resaleIllustrationDetails}
          src={
            shopCreationIllustrations
              ? '/static/images/create-product/shop-listing-details.png'
              : '/static/images/create-product/listing-details.png'
          }
          alt=""
          aria-hidden="true"
          loading="lazy"
        />
      )}
    </>,
    <div
      key="fulfillment-description"
      className={styles.fulfillmentDescriptionStep}
    >
      <div className={styles.resaleFulfillmentLeft}>
        {fulfillmentField}
        {(resaleUpload || shopCreationIllustrations) && (
          <img
            className={styles.resaleIllustrationFulfillment}
            src={
              shopCreationIllustrations
                ? '/static/images/create-product/shop-fulfillment-location.png'
                : '/static/images/create-product/fulfillment-location.png'
            }
            alt=""
            aria-hidden="true"
            loading="lazy"
          />
        )}
      </div>
      <div className={styles.descriptionColumn}>
        {meetingLocationField}
        {fields.preferredFulfillment === 'ON_CAMPUS'
          ? locationDetailField
          : deliveryDestinationField}
      </div>
    </div>,
    paymentField,
    reviewField,
  ]
  const stepTitles = [
    'Photos',
    context.details,
    'Fulfillment & Location',
    'Payment',
    'Review & Publish',
  ]
  const stepDescriptions = [
    'Add 1-6 photos. The first image is the cover.',
    'Describe your item using its current details.',
    'Choose how and where you can fulfill the exchange.',
    'Choose a supported payment preference.',
    'Review your item before publishing.',
  ]
  // Published Resale images are immutable; Edit omits Photos but keeps mixed-permission Details.
  const wizardStepIndices =
    listing && presentation === 'sheet' ? [1, 2, 3, 4] : [0, 1, 2, 3, 4]
  const creationWizard = (
    <MultiStepForm
      embedded={presentation === 'sheet'}
      contentSizedDesktop={
        presentation === 'sheet' && channel === 'resale' && Boolean(listing)
      }
      key={createGeneration}
      disabled={busy || Boolean(pending) || Boolean(created)}
      publishAction={publishAction}
      steps={wizardStepIndices.map((index) => ({
        title: listing && index === 4 ? 'Review Changes' : stepTitles[index],
        description:
          listing && index === 4
            ? 'Review your changes before saving.'
            : stepDescriptions[index],
        content: (
          <fieldset
            data-wizard-step={index}
            className={
              shopCreationIllustrations
                ? styles.shopWizardStep
                : resaleUpload
                ? styles.resaleLayoutStep
                : undefined
            }
            disabled={busy || Boolean(pending)}
          >
            {stepContents[index]}
            {(error || stepError) && <p role="alert">{error || stepError}</p>}
          </fieldset>
        ),
      }))}
      onStepChange={() => setStepError('')}
      onContinue={(step) => validateStep(wizardStepIndices[step])}
    />
  )
  if (sessionLoading)
    return (
      <div
        className={listing ? styles.builder : wizard.host}
        role="status"
        aria-label="Loading listing editor"
      >
        <div
          className={listing ? styles.form : wizard.card}
          style={{
            display: 'grid',
            gap: 24,
            padding: listing ? undefined : 24,
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((id) => (
            <div key={id}>
              <Skeleton
                style={{ height: 16, width: '40%', marginBottom: 12 }}
              />
              <Skeleton style={{ height: 44 }} />
            </div>
          ))}
        </div>
        {listing && (
          <Skeleton style={{ aspectRatio: '4 / 3', width: '100%' }} />
        )}
      </div>
    )
  if (sessionError) return <p role="alert">{sessionError}</p>
  if (listing && listing.status !== 'available')
    return (
      <p>
        {listing.status === 'reserved' ? 'Reserved' : 'Sold'} listings are
        read-only.
      </p>
    )
  return (
    <FormProvider {...form}>
      <div
        ref={builderRef}
        className={wizardPresentation ? wizard.creation : styles.builder}
        onScrollCapture={(event) => {
          if (channel !== 'shop' || !wizardPresentation) return
          const target = event.target
          if (
            !(target instanceof HTMLElement) ||
            !target.matches('[class*="viewport"]')
          )
            return
          target.dataset.scrolling = 'true'
          if (shopScrollbarTimer.current !== null)
            clearTimeout(shopScrollbarTimer.current)
          shopScrollbarTimer.current = setTimeout(() => {
            delete target.dataset.scrolling
            shopScrollbarTimer.current = null
          }, 1000)
        }}
        data-listing-channel={channel}
        data-listing-builder={listing ? 'edit' : 'create'}
      >
        <form
          className={wizardPresentation ? wizard.creationForm : styles.form}
          data-photo-count={files.length}
          aria-label={listing ? 'Edit listing' : context.heading}
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault()
            if (listing && !wizardPresentation) save()
          }}
        >
          {wizardPresentation ? (
            creationWizard
          ) : (
            <fieldset disabled={busy || Boolean(pending)}>
              <legend className={styles.srOnly}>Listing details</legend>
              {photosField}
              {titleField}
              {priceField}
              {categoryField}
              {conditionField}
              {fulfillmentField}
              {meetingLocationField}
              {locationDetailField}
              {descriptionField}
            </fieldset>
          )}
          {listing && !wizardPresentation && error && (
            <p role="alert">{error}</p>
          )}
          {listing &&
            !wizardPresentation &&
            !error &&
            validation &&
            validation !== 'Choose 1-6 photos.' && (
              <p className={styles.hint}>{validation}</p>
            )}
          {listing && !wizardPresentation && (
            <div className={!listing ? styles.createFooter : undefined}>
              <ActionRow mobileThree={!listing}>
                <CardAction
                  disabled={busy}
                  onClick={() =>
                    requestLeave(
                      onCancel ??
                        (() =>
                          window.location.assign('/home?section=my-listings'))
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
              </ActionRow>
            </div>
          )}
          {listing && !wizardPresentation && (
            <div className={styles.submit}>
              <CardAction type="submit" disabled={disabled}>
                {busy ? 'Saving...' : 'Save changes'}
              </CardAction>
            </div>
          )}
        </form>
        {listing && !wizardPresentation && (
          <aside className={styles.previewColumn}>
            <ExpandedCardPreview
              {...previewProps}
              className={styles.inlinePreview}
            />
          </aside>
        )}
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
              setFields(initialListingFields(undefined, channel))
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
    </FormProvider>
  )
}
