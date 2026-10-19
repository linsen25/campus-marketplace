/* eslint @next/next/no-img-element: off -- Local object URLs and immutable listing photos. */

import { AnimatePresence } from 'framer-motion'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { SetStateAction } from 'react'
/* eslint jsx-a11y/no-onchange: off -- Form controls update only the local preview. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FormProvider, useForm, useWatch } from 'react-hook-form'

import { AccessibleAction } from '@/components/accessible-action'
import WorkButton from '@/components/animata/button/work-button'
import MultiStepForm from '@/components/multi-step-form'
import wizard from '@/components/multi-step-form.module.css'
import { ShopListingWorkspace } from '@/components/shops/shop-listing-workspace'
import GlideSelect from '@/components/ui/GlideSelect'
import { ActionRow } from '@/components/ui/action-row'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { Skeleton } from '@/components/ui/skeleton'
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
import { listingFulfillmentEnabled } from '@/lib/listing-fulfillment'
import { validateListingImage } from '@/lib/listing-images'
import { listingCategories, listingConditions } from '@/lib/listing-metadata'
import {
  createPublishedListing,
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
  const initial = useMemo(() => initialListingFields(listing), [listing])
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
  const channel = listing?.listingChannel ?? mode
  const wizardPresentation = !listing || presentation === 'sheet'
  const resaleUpload =
    !listing && channel === 'resale' && presentation === 'sheet'
  const context = {
    ...listingWizardModes[channel],
    heading:
      channel === 'resale' ? createLabel : listingWizardModes.shop.heading,
  }
  const shopBlocked = !listing && channel === 'shop'
  const [stepError, setStepError] = useState('')
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
      try {
        return (
          Boolean(parseMeetingLocation(value)) ||
          'Meeting location is required.'
        )
      } catch (reason) {
        return message(reason)
      }
    },
  })
  form.register('estimatedDeliveryFee', {
    validate: (value) =>
      form.getValues('preferredFulfillment') !== 'DELIVERY' ||
      parseOfferAmount(value.trim() || '0', true) !== null ||
      'Enter a non-negative estimated delivery fee with up to two decimal places.',
  })
  form.register('preferredPaymentMode', {
    validate: (value) =>
      (['external', 'uu_pay'].includes(value) &&
        (form.getValues('preferredFulfillment') !== 'DELIVERY' ||
          value === 'uu_pay')) ||
      'Delivery uses UU Pay.',
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
  const preview: Listing = {
    ...(listing ?? {
      listingChannel: channel,
      id: 'local-preview',
      createdAt: '',
      updatedAt: '',
      status: 'available',
      publishedAt: null,
    }),
    ...fields,
    estimatedDeliveryFeeCents:
      parseOfferAmount(fields.estimatedDeliveryFee.trim() || '0', true) ?? 0,
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
    else window.location.assign(context.destination)
  }
  async function save() {
    if (shopBlocked) {
      setError(
        'Shop product publication is not available without authoritative eligibility.'
      )
      return false
    }
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
          meetingLocation: input.meetingLocation,
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
      const result = pending
        ? await continueListingPublication(pending.listingId)
        : await createPublishedListing(input, files)
      if (result.state === 'published') {
        if (presentation === 'sheet') complete(result.listing)
        else setCreated(result.listing)
        return true
      }
      setPending(result)
      setError(
        `${result.error} Continue publication to retry this same listing.`
      )
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
  const photosField = (
    <>
      <div
        className={`${styles.field} ${
          wizardPresentation ? wizard.photos : ''
        } ${resaleUpload ? styles.resalePhotoStep : ''}`}
      >
        <div
          className={`${wizard.photoUpload} ${
            resaleUpload ? styles.resalePhotoUpload : ''
          }`}
          data-resale-photo-upload={resaleUpload || undefined}
        >
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
        </div>
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
          <p>{listing.subcategory}</p>
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
        <div className={styles.field}>
          <span>Preferred fulfillment</span>
          <GlideSelect
            overlay={wizardPresentation}
            ariaLabel="Preferred fulfillment"
            size="lg"
            surfaceColor="#2a2134"
            highlightColor="#443451"
            value={fields.preferredFulfillment}
            disabled={busy || Boolean(pending)}
            options={[
              { value: 'ON_CAMPUS', label: 'Meeting' },
              { value: 'DELIVERY', label: 'Delivery' },
            ]}
            onChange={(value: string) => {
              if (value === 'DELIVERY' || value === 'ON_CAMPUS')
                change('preferredFulfillment', value)
            }}
          />
          <small>Buyers may propose another fulfillment mode.</small>
          {listing && fields.preferredFulfillment === 'ON_CAMPUS' && (
            <label className={styles.field}>
              Preferred payment
              <GlideSelect
                overlay={wizardPresentation}
                ariaLabel="Payment method"
                value={fields.preferredPaymentMode}
                disabled={busy || Boolean(pending)}
                options={[
                  { value: 'uu_pay', label: 'Pay by UU (recommended)' },
                  { value: 'external', label: 'Pay independently' },
                ]}
                onChange={(value: string) =>
                  change('preferredPaymentMode', value as 'external' | 'uu_pay')
                }
              />
              <small>
                A default preference. Buyers may propose the other payment
                method.
              </small>
            </label>
          )}
          <MeetingLocationInput
            required={true}
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
            onChange={(value) =>
              setFields((current) => ({
                ...current,
                meetingLocation: value.trim() ? { label: value } : null,
              }))
            }
            onSelect={(place) =>
              setFields((current) => ({
                ...current,
                meetingLocation: current.meetingLocation
                  ? {
                      label: current.meetingLocation.label,
                      ...(place
                        ? { provider: 'google', placeId: place.placeId }
                        : {}),
                    }
                  : null,
              }))
            }
          />
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
  const descriptionField = (
    <>
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
    </>
  )
  const stepFields: Array<Array<keyof ListingFields>> = [
    [],
    ['title', 'price', 'condition', 'category', 'subcategory'],
    ['meetingLocation', 'estimatedDeliveryFee', 'description'],
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
    }
    return valid
  }
  const paymentField = (
    <div className={wizard.payment}>
      <label>
        <input
          type="radio"
          name="wizardPayment"
          value="external"
          checked={fields.preferredPaymentMode === 'external'}
          disabled={
            fields.preferredFulfillment === 'DELIVERY' ||
            busy ||
            Boolean(pending)
          }
          onChange={() => change('preferredPaymentMode', 'external')}
        />
        <span>
          <strong>Arrange Payment Directly</strong>
          {channel === 'resale' ? (
            <>
              <p>
                {fields.preferredFulfillment === 'DELIVERY'
                  ? 'Unavailable for Delivery. Delivery requires UU Pay.'
                  : 'You and the buyer arrange payment outside UU.'}
              </p>
              <p>Before completing the exchange:</p>
              <ul>
                <li>
                  Confirm funds in your own bank or payment account.
                  Screenshots, emails and messages are not proof of payment.
                </li>
                <li>
                  Do not hand over or ship the item until you have confirmed
                  payment yourself.
                </li>
                <li>
                  Meet in a public, appropriate location and allow inspection
                  where practical.
                </li>
                <li>Keep a record of the agreed price and exchange details.</li>
              </ul>
              <p>
                Never send money to receive money. Be cautious of overpayment or
                refund requests.
              </p>
              <p>
                External payments happen outside UU. UU cannot verify, reverse,
                refund or provide payment protection for them.
              </p>
            </>
          ) : (
            <p>
              {fields.preferredFulfillment === 'DELIVERY'
                ? 'Unavailable for Delivery. Delivery uses UU Pay.'
                : 'You and the buyer arrange payment outside UU. UU does not process, hold, reverse or protect this payment. Verify the item and payment details before completing the exchange; do not rely on payment screenshots alone.'}
            </p>
          )}
        </span>
      </label>
      <label>
        <input
          type="radio"
          name="wizardPayment"
          value="uu_pay"
          checked={fields.preferredPaymentMode === 'uu_pay'}
          disabled={busy || Boolean(pending)}
          onChange={() => change('preferredPaymentMode', 'uu_pay')}
        />
        <span>
          <strong>UU Pay</strong>
          <p>Payment is securely processed by Stripe.</p>
          {channel === 'resale' && (
            <>
              <ul>
                <li>
                  Stripe is the third-party payment processor. Confirm payment
                  status in the supported UU/Stripe flow, rather than relying on
                  another user&apos;s screenshot.
                </li>
                {fields.preferredFulfillment === 'DELIVERY' ? (
                  <>
                    <li>
                      Delivery requires UU Pay. Keep tracking or other
                      verifiable delivery evidence where practical.
                    </li>
                    <li>
                      Keep photos of the item&apos;s condition and packaging,
                      plus shipping or delivery receipts.
                    </li>
                  </>
                ) : (
                  <li>
                    Meet in a public, appropriate location and allow the buyer
                    to inspect the item where practical.
                  </li>
                )}
                <li>
                  Keep transaction and fulfillment records until the exchange is
                  complete.
                </li>
              </ul>
              <p>{context.serviceFee}</p>
            </>
          )}

          <p>
            Stripe processing fees may apply. The exact fee will be shown before
            payment is confirmed.
          </p>
        </span>
      </label>
      <p className={wizard.notice}>
        This is your default preference. Buyers may propose another supported
        payment method. Creating a Listing does not charge anyone.
      </p>
    </div>
  )
  const reviewField = (
    <div className={wizard.review} data-review-channel={channel}>
      <ExpandedCardPreview
        {...previewProps}
        className={`${styles.inlinePreview} ${wizard.reviewCard}`}
      >
        <PublishedListingDetails listing={preview} />
        {fields.preferredFulfillment === 'DELIVERY' &&
          fields.meetingLocation && (
            <p className={wizard.notice}>
              Meeting location: {fields.meetingLocation.label}
            </p>
          )}
      </ExpandedCardPreview>
    </div>
  )
  let publishLabel: string = context.publish
  if (channel === 'resale') publishLabel = 'Confirm & Publish'
  if (listing) publishLabel = 'Save Changes'
  const publishAction = (
    <StatefulButton
      key={createGeneration}
      className={wizard.publish}
      disabled={disabled || Boolean(created) || shopBlocked}
      resetAfter={2000}
      successText={listing ? 'Saved' : 'Published'}
      errorText="Retry"
      onStateChange={createStateChanged}
      onClick={async () => {
        if (!(await save())) throw new Error('Publication was not confirmed.')
      }}
    >
      {publishLabel}
    </StatefulButton>
  )
  const stepContents = [
    photosField,
    <>
      {titleField}
      {priceField}
      {conditionField}
      {categoryField}
    </>,
    <>
      {fulfillmentField}
      {descriptionField}
    </>,
    paymentField,
    reviewField,
  ]
  const stepTitles = [
    'Photos',
    context.details,
    'Fulfillment & Description',
    'Payment',
    'Review & Publish',
  ]
  const stepDescriptions = [
    'Add 1-6 photos. The first image is the cover.',
    'Describe your item using its current details.',
    'Choose how to exchange the item and add its description.',
    'Choose a supported payment preference.',
    'Review your item before publishing.',
  ]
  // Published Resale images are immutable; Edit omits Photos but keeps mixed-permission Details.
  const wizardStepIndices =
    listing && presentation === 'sheet' ? [1, 2, 3, 4] : [0, 1, 2, 3, 4]
  const creationWizard = (
    <MultiStepForm
      embedded={presentation === 'sheet'}
      contentSizedDesktop={presentation === 'sheet' && channel === 'resale'}
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
  if (shopBlocked && !previewOnly) return <ShopListingWorkspace create={true} />
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
    </FormProvider>
  )
}
