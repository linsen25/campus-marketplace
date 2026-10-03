'use client'

import cn from 'classnames'
import type {
  ComponentProps,
  FocusEvent,
  KeyboardEvent,
  ReactNode,
} from 'react'
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
} from 'react'

import {
  handleTabListFocusCapture,
  handleTabListKeyDown,
  tabFocusClass,
  useTabSelection,
} from './shared'
import styles from './shift-tabs.module.css'

type ShiftTabsContextValue = {
  activeIndex: number
  setActiveIndex: (index: number) => void
  focusedIndex: number
  setFocusedIndex: (index: number) => void
}

const ShiftTabsContext = createContext<ShiftTabsContextValue | null>(null)

type ShiftTabSlotContextValue = {
  index: number
}

const ShiftTabSlotContext = createContext<ShiftTabSlotContextValue | null>(null)

function useShiftTabs() {
  const context = useContext(ShiftTabsContext)
  if (!context) {
    throw new Error('ShiftTabs primitives must be used within <ShiftTabs>.')
  }
  return context
}

function ShiftTabSlot({
  index,
  children,
}: {
  index: number
  children: ReactNode
}) {
  const value = useMemo(() => ({ index }), [index])
  return (
    <ShiftTabSlotContext.Provider value={value}>
      {children}
    </ShiftTabSlotContext.Provider>
  )
}

function useShiftTabSlot() {
  const context = useContext(ShiftTabSlotContext)
  if (!context) {
    throw new Error('ShiftTabs.Tab must be a direct child of <ShiftTabs.List>.')
  }
  return context
}

type ShiftTabsRootProps = {
  children: ReactNode
  defaultActiveIndex?: number
  activeIndex?: number
  onActiveIndexChange?: (index: number) => void
  className?: string
}

function ShiftTabsRoot({
  children,
  defaultActiveIndex = 0,
  activeIndex: activeIndexProp,
  onActiveIndexChange,
  className,
}: ShiftTabsRootProps) {
  const { activeIndex, setActiveIndex, focusedIndex, setFocusedIndex } =
    useTabSelection({
      defaultActiveIndex,
      activeIndex: activeIndexProp,
      onActiveIndexChange,
    })

  const rootContext = useMemo(
    () => ({ activeIndex, setActiveIndex, focusedIndex, setFocusedIndex }),
    [activeIndex, setActiveIndex, focusedIndex, setFocusedIndex]
  )

  return (
    <ShiftTabsContext.Provider value={rootContext}>
      <div className={className}>{children}</div>
    </ShiftTabsContext.Provider>
  )
}

type ShiftTabsListProps = ComponentProps<'nav'> & {
  'aria-label'?: string
}

function ShiftTabsList({
  className,
  children,
  'aria-label': ariaLabel = 'Tabs',
  onKeyDown,
  onFocusCapture,
  ...props
}: ShiftTabsListProps) {
  const { activeIndex, setActiveIndex, setFocusedIndex } = useShiftTabs()
  const tabs = Children.toArray(children).filter(isValidElement)
  const count = tabs.length

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(styles.nav, className)}
      {...props}
    >
      <div
        role="tablist"
        tabIndex={0}
        className={styles.list}
        onFocusCapture={(event: FocusEvent<HTMLElement>) => {
          onFocusCapture?.(event)
          handleTabListFocusCapture(event, activeIndex, setFocusedIndex)
        }}
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          onKeyDown?.(event)
          if (!event.defaultPrevented) {
            handleTabListKeyDown(event, count, setActiveIndex, setFocusedIndex)
          }
        }}
      >
        {tabs.map((tab, index) => (
          <ShiftTabSlot key={tab.key ?? index} index={index}>
            {tab}
          </ShiftTabSlot>
        ))}
      </div>
    </nav>
  )
}

function ShiftTabsLabel({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn(styles.label, className)} {...props} />
}

type ShiftTabsTabProps = ComponentProps<'button'> & {
  label?: string
}

function ShiftTabsTab({
  className,
  children,
  label,
  onClick,
  onFocus,
  ...props
}: ShiftTabsTabProps) {
  const { activeIndex, setActiveIndex, setFocusedIndex } = useShiftTabs()
  const { index } = useShiftTabSlot()
  const isSelected = activeIndex === index

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      {...(label ? { 'aria-label': label } : {})}
      className={cn(
        tabFocusClass(styles.tab),
        styles.transition,
        styles.press,
        isSelected ? styles.selected : styles.unselected,
        className
      )}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          setActiveIndex(index)
        }
      }}
      onFocus={(event: FocusEvent<HTMLButtonElement>) => {
        onFocus?.(event)
        if (!event.defaultPrevented) {
          setFocusedIndex(index)
        }
      }}
      {...props}
    >
      <span
        className={cn(
          styles.face,
          styles.faceMotion,
          isSelected ? styles.faceSelected : styles.faceUnselected
        )}
      >
        {children}
      </span>
    </button>
  )
}

const ShiftTabs = Object.assign(ShiftTabsRoot, {
  List: ShiftTabsList,
  Tab: ShiftTabsTab,
  Label: ShiftTabsLabel,
})

export default ShiftTabs
export {
  ShiftTabsLabel,
  ShiftTabsList,
  ShiftTabsRoot,
  ShiftTabsTab,
  useShiftTabs,
}
