import { m } from 'framer-motion'
import { useCallback, useMemo, useRef, useState } from 'react'

import { createAnimatedPlaceholderPlugin } from '@/lib/autocomplete/plugins/createAnimatedPlaceholderPlugin'
import { createClearLeftPlugin } from '@/lib/autocomplete/plugins/createClearLeftPlugin'
import { createFocusBlurPlugin } from '@/lib/autocomplete/plugins/createFocusBlurPlugin'
import { useLaptopMediaQuery } from '@/lib/media'
import { Autocomplete } from '@autocomplete/_default/autocomplete'
import { searchButtonPluginCreator } from '@autocomplete/plugins/search-button'

// Interaction from NavAutocomplete/AutocompleteBasic at d2bf059, using only
// marketplace submission. No retail sources or InstantSearch state are attached.
export function MarketplaceSearch({
  query,
  onSearch,
}: {
  query: string
  onSearch: (query: string) => void
}) {
  const isLaptop = useLaptopMediaQuery()
  const [focused, setFocused] = useState(false)
  const [hasQuery, setHasQuery] = useState(Boolean(query))
  const submitRef = useRef(onSearch)
  submitRef.current = onSearch
  const submit = useCallback(({ state }: { state: { query: string } }) => {
    submitRef.current(state.query.trim())
  }, [])
  const plugins = useMemo(
    () => [
      createAnimatedPlaceholderPlugin({
        enabled: true,
        placeholders: ['desks', 'books', 'electronics'],
        placeholderTemplate: (value: string) => `Search ${value}`,
      }),
      createClearLeftPlugin({ initialQuery: query }),
      searchButtonPluginCreator({ initialQuery: query, onClick: submit }),
      createFocusBlurPlugin({ onFocusBlur: setFocused }),
    ],
    [query, submit]
  )
  const stateChanged = useCallback(
    ({ state }: { state: { query: string } }) => {
      setHasQuery(Boolean(state.query))
    },
    []
  )
  const reset = useCallback(() => submitRef.current(''), [])
  const desktopWidth = focused || hasQuery ? '90%' : '20rem'
  return (
    <div
      className="relative flex min-h-[44px] w-full items-center"
      role="search"
      aria-label="Search marketplace"
    >
      <m.div
        className={`relative flex min-h-[44px] items-center ${
          focused || hasQuery ? 'focused' : ''
        }`}
        animate={{
          width: isLaptop ? desktopWidth : '100%',
        }}
        transition={{ type: 'spring', duration: 0.6 }}
      >
        <Autocomplete
          initialQuery={query}
          plugins={plugins}
          placeholder="Search listings"
          detachedMediaQuery="none"
          shouldPanelOpen={() => false}
          onSubmit={submit}
          onReset={reset}
          onStateChange={stateChanged}
        />
      </m.div>
    </div>
  )
}
