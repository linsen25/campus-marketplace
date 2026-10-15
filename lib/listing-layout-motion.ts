/** The Market expanded-listing layout spring, shared without a separate scroll system. */
export const listingLayoutTransition = (reduced: boolean | null) =>
  reduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 320, damping: 32 }
