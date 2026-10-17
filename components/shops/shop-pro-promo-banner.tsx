import { AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'

import { ShopProPricingSheet } from './shop-pro-pricing-sheet'
import styles from './shop-pro-pricing.module.css'

/** Local decorative artwork; no external assets or runtime illustration dependency. */
function ShopEntrepreneur() {
  return (
    <svg
      className={styles.illustration}
      viewBox="0 0 180 132"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* A small storefront stays secondary to the student seller. */}
      <rect x="111" y="37" width="46" height="42" rx="5" fill="#EFF3DC" />
      <path d="M109 37L116 23H152L159 37H109Z" fill="#FFF4CF" />
      <path
        d="M116 23H125L122 37H109L116 23ZM136 23H145L149 37H136V23Z"
        fill="#85B58E"
      />
      <path
        d="M109 37H159V41C159 48 147 48 147 41C147 48 135 48 135 41C135 48 122 48 122 41C122 48 109 48 109 41V37Z"
        fill="#A9CD9F"
      />
      <rect x="123" y="54" width="21" height="14" rx="3" fill="#C9DEBE" />
      {/* Soft shapes, everyday clothes, and a friendly open expression. */}
      <path d="M57 88H88L96 120H82L71 99L66 120H52L57 88Z" fill="#4F8064" />
      <path
        d="M51 119H67V126H46C45 122 48 119 51 119ZM82 119H96L103 126H82V119Z"
        fill="#FFF4CF"
      />
      <path
        d="M63 52H80C94 52 100 69 99 93H48C48 69 50 55 63 52Z"
        fill="#FAF2D9"
      />
      <path d="M64 47V56C67 62 77 62 81 55L79 45L64 47Z" fill="#DCA580" />
      <path
        d="M53 28C52 13 65 7 77 11C90 9 97 22 92 38L55 39L53 28Z"
        fill="#3D604C"
      />
      <ellipse cx="73" cy="34" rx="18" ry="21" fill="#EABD98" />
      <path
        d="M54 30C52 15 64 7 77 11C89 9 96 20 93 29C83 29 77 24 74 19C70 27 61 30 54 30Z"
        fill="#3D604C"
      />
      <circle cx="66" cy="34" r="1.5" fill="#3E4C3F" />
      <circle cx="80" cy="34" r="1.5" fill="#3E4C3F" />
      <path
        d="M68 43C71 46 76 46 79 42"
        stroke="#875A44"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M54 60L44 76L37 69"
        stroke="#EABD98"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="27"
        y="51"
        width="16"
        height="25"
        rx="4"
        transform="rotate(-12 27 51)"
        fill="#4F8064"
      />
      <rect
        x="31"
        y="55"
        width="9"
        height="15"
        rx="2"
        transform="rotate(-12 31 55)"
        fill="#E4EED8"
      />
      <path
        d="M90 62L103 80L116 84"
        stroke="#EABD98"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* A parcel gives the illustration a clear, lightweight selling cue. */}
      <rect x="100" y="85" width="46" height="37" rx="5" fill="#E6D5A8" />
      <path d="M119 85H127V101L123 98L119 101V85Z" fill="#FFF4CF" />
      <path
        d="M110 111H120"
        stroke="#A28C62"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ShopProPromoBanner() {
  const [dismissed, setDismissed] = useState(false)
  const [open, setOpen] = useState(false)
  return (
    <>
      {!dismissed && (
        <aside className={styles.banner} aria-label="Shop Pro promotion">
          <ShopEntrepreneur />
          <div className={styles.bannerCopy}>
            <h2>Want your own shop?</h2>
            <p>Subscribe to Shop Pro and create your own storefront.</p>
          </div>
          <ShiningButton variant="green" onClick={() => setOpen(true)}>
            Explore Shop Pro
          </ShiningButton>
          <button
            type="button"
            className={styles.dismiss}
            aria-label="Dismiss Shop Pro promotion"
            onClick={() => setDismissed(true)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </aside>
      )}
      <AnimatePresence>
        {open && <ShopProPricingSheet onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  )
}
