import type { FormEvent } from 'react'
import { useCallback, useRef, useState } from 'react'

import { ListingPicker } from '@/components/listings/listing-picker'
import { listingImageRules, validateListingImage } from '@/lib/listing-images'
import { listingCategories, listingConditions } from '@/lib/listing-metadata'
import { listingLimits, validateListingInput } from '@/lib/listing-validation'
import {
  createListing,
  updateListing,
  uploadListingImage,
  removeListingImage,
} from '@/lib/listings-api'
import type { Listing } from '@/types/listing'
import { parseListingPrice } from '@/utils/parse-listing-price'
import { Input } from '@ui/input/input'
import { Link } from '@ui/link/link'

export type ListingFormProps = { listing?: Listing }

function validateSelectedPhoto(file: File) {
  try {
    validateListingImage(file)
  } catch (cause) {
    if (!listingImageRules.mimeTypes.includes(file.type))
      throw new Error(`${file.name} is not supported. Use JPEG, PNG, or WebP.`)
    if (file.size > listingImageRules.maxBytes)
      throw new Error(
        `${file.name} is ${(file.size / (1024 * 1024)).toFixed(
          2
        )} MB. Maximum size is 3 MB.`
      )
    throw new Error(
      `${file.name}: ${
        cause instanceof Error ? cause.message : 'Invalid image.'
      }`
    )
  }
}

export function ListingForm({ listing }: ListingFormProps) {
  const savedListing = useRef(listing)
  const [photos, setPhotos] = useState(listing?.photoUrls || [])
  const [files, setFiles] = useState<File[]>([])
  const [removedUrls, setRemovedUrls] = useState<string[]>([])
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fieldClass = 'flex min-w-0 flex-col gap-2'
  const controlClass =
    'input focus-visible:ring-2 focus-visible:ring-brand-black'
  const price = listing
    ? `${Math.floor(listing.price / 100)}.${String(
        listing.price % 100
      ).padStart(2, '0')}`
    : ''

  const submitLabel = savedListing.current ? 'Save changes' : 'Post listing'
  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (submitting.current) return
      const data = new FormData(event.currentTarget)
      const read = (name: string) => String(data.get(name) || '')
      setError(null)
      setPhotoError(null)
      let textSaved = false
      try {
        const input = validateListingInput({
          title: read('title'),
          description: read('description'),
          price: parseListingPrice(read('price')),
          currency: 'CAD',
          category: read('category'),
          condition: read('condition') || undefined,
          pickupArea: read('pickupArea'),
          photoUrls: [],
        })
        try {
          if (
            photos.length - removedUrls.length + files.length >
            listingImageRules.maxFiles
          )
            throw new Error('Use at most six images per listing.')
          files.forEach(validateSelectedPhoto)
        } catch (cause) {
          setPhotoError(
            cause instanceof Error ? cause.message : 'Invalid images.'
          )
          return
        }
        submitting.current = true
        setBusy(true)
        const editable = {
          title: input.title,
          description: input.description,
          price: input.price,
          currency: input.currency,
          category: input.category,
          condition: input.condition,
          pickupArea: input.pickupArea,
        }
        const saved = savedListing.current
          ? await updateListing(savedListing.current.id, {
              ...editable,
              condition: input.condition ?? null,
            })
          : await createListing(input)
        savedListing.current = saved
        textSaved = true
        for (const url of removedUrls) {
          const updated = await removeListingImage(saved.id, url)
          setPhotos(updated.photoUrls)
          setRemovedUrls((urls) => urls.filter((item) => item !== url))
        }
        for (const file of files) {
          const updated = await uploadListingImage(saved.id, file)
          setPhotos(updated.photoUrls)
          setFiles((items) => items.filter((item) => item !== file))
        }
        window.location.assign('/profile/listings')
      } catch (cause) {
        const setSaveError = textSaved ? setPhotoError : setError
        setSaveError(
          cause instanceof Error
            ? `${
                textSaved
                  ? 'Listing saved. You can retry any unfinished image changes. '
                  : ''
              }${cause.message}`
            : 'Unable to save this listing. Please try again.'
        )
      } finally {
        submitting.current = false
        setBusy(false)
      }
    },
    [files, photos, removedUrls]
  )

  return (
    <form
      className="flex flex-col gap-6"
      aria-label={listing ? 'Edit listing' : 'Create listing'}
      aria-busy={busy}
      onSubmit={handleSubmit}
    >
      {error && <p role="alert">{error}</p>}
      {listing && (
        <p>
          Status:{' '}
          <strong>{listing.status === 'sold' ? 'SOLD' : 'Available'}</strong>.
          Manage status in My Listings.
        </p>
      )}
      <fieldset
        disabled={busy}
        className="grid min-w-0 grid-cols-1 gap-4 tablet:grid-cols-2"
      >
        <legend className="sr-only">Listing details</legend>
        <label className={`${fieldClass} tablet:col-span-2`}>
          <span className="small-bold">Title *</span>
          <Input
            name="title"
            required={true}
            maxLength={listingLimits.title}
            defaultValue={listing?.title || ''}
            className={controlClass}
          />
        </label>
        <label className={`${fieldClass} tablet:col-span-2`}>
          <span className="small-bold">Description</span>
          <textarea
            name="description"
            maxLength={listingLimits.description}
            defaultValue={listing?.description || ''}
            rows={5}
            className={`${controlClass} h-auto py-3`}
          />
        </label>
        <label className={fieldClass}>
          <span className="small-bold">Price (CA$) *</span>
          <Input
            name="price"
            type="text"
            inputMode="decimal"
            required={true}
            pattern="[0-9]+([.][0-9]{1,2})?"
            defaultValue={price}
            placeholder="12.50"
            className={controlClass}
            aria-describedby="listing-price-help"
          />
          <span id="listing-price-help" className="text-neutral-dark text-sm">
            Enter CAD dollars. Use 0 for FREE.
          </span>
        </label>
        <ListingPicker
          name="category"
          label="Category"
          options={listingCategories}
          placeholder="Choose a category"
          defaultValue={listing?.category || ''}
          required={true}
        />
        <ListingPicker
          name="condition"
          label="Condition"
          options={listingConditions}
          placeholder="Not specified"
          defaultValue={listing?.condition || ''}
        />
        <label className={fieldClass}>
          <span className="small-bold">Pickup area *</span>
          <Input
            name="pickupArea"
            required={true}
            maxLength={listingLimits.pickupArea}
            defaultValue={listing?.pickupArea || ''}
            placeholder="Near Western"
            className={controlClass}
          />
        </label>
        <div className={`${fieldClass} tablet:col-span-2`}>
          <label className={fieldClass}>
            <span className="small-bold">Photos (optional)</span>
            <Input
              name="photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple={true}
              aria-invalid={Boolean(photoError)}
              aria-describedby={`listing-photos-help listing-photos-selection${
                photoError ? ' listing-photos-error' : ''
              }`}
              onChange={(event) => {
                const selected = Array.from(event.target.files || [])
                try {
                  if (
                    selected.length + photos.length - removedUrls.length >
                    listingImageRules.maxFiles
                  )
                    throw new Error('Use at most six images per listing.')
                  selected.forEach(validateSelectedPhoto)
                  setFiles(selected)
                  setPhotoError(null)
                } catch (cause) {
                  setFiles([])
                  const fileInput = event.currentTarget
                  fileInput.value = ''
                  setPhotoError(
                    cause instanceof Error ? cause.message : 'Invalid images.'
                  )
                }
              }}
            />
          </label>
          <p id="listing-photos-help" className="text-neutral-dark text-sm">
            JPEG, PNG, or WebP · max {listingImageRules.maxFiles} images · 3 MB
            each
            <br />
            The limit includes existing photos kept on the listing.
          </p>
          {photoError && (
            <p id="listing-photos-error" role="alert">
              {photoError}
            </p>
          )}
          <div id="listing-photos-selection" aria-live="polite">
            {files.length > 0 && (
              <>
                <p>
                  {files.length} {files.length === 1 ? 'file' : 'files'}{' '}
                  selected for upload:
                </p>
                <p className="break-words">
                  {files.map((file) => file.name).join(', ')}
                </p>
              </>
            )}
          </div>
          {photos.map((url, index) => (
            <label key={url} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={removedUrls.includes(url)}
                onChange={(event) =>
                  setRemovedUrls((urls) =>
                    event.target.checked
                      ? [...urls, url]
                      : urls.filter((item) => item !== url)
                  )
                }
              />
              <span>Remove photo {index + 1} when saving</span>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                View photo {index + 1}
              </a>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary btn-small"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        {!busy && (
          <Link href="/profile/listings" className="underline">
            Cancel
          </Link>
        )}
      </div>
    </form>
  )
}
