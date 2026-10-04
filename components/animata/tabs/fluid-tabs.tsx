'use client'

import cn from 'classnames'
import { motion } from 'motion/react'
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
  useId,
  useMemo,
} from 'react'

import styles from './fluid-tabs.module.css'
import {
  handleTabListFocusCapture,
  handleTabListKeyDown,
  tabFocusClass,
  useTabSelection,
} from './shared'

const INDICATOR_SPRING = {
  type: 'spring' as const,
  stiffness: 380,
  damping: 34,
  mass: 0.75,
}

const LABEL_TRANSITION = {
  duration: 0.28,
  ease: [0.32, 0.72, 0, 1] as const,
}

type FluidTabsContextValue = {
  activeIndex: number
  setActiveIndex: (index: number) => void
  focusedIndex: number
  setFocusedIndex: (index: number) => void
  indicatorLayoutId: string
}

const FluidTabsContext = createContext<FluidTabsContextValue | null>(null)

type FluidTabSlotContextValue = {
  index: number
}

const FluidTabSlotContext = createContext<FluidTabSlotContextValue | null>(null)

function useFluidTabs() {
  const context = useContext(FluidTabsContext)
  if (!context) {
    throw new Error('FluidTabs primitives must be used within <FluidTabs>.')
  }
  return context
}

function FluidTabSlot({
  index,
  children,
}: {
  index: number
  children: ReactNode
}) {
  const value = useMemo(() => ({ index }), [index])
  return (
    <FluidTabSlotContext.Provider value={value}>
      {children}
    </FluidTabSlotContext.Provider>
  )
}

function useFluidTabSlot() {
  const context = useContext(FluidTabSlotContext)
  if (!context) {
    throw new Error('FluidTabs.Tab must be a direct child of <FluidTabs.List>.')
  }
  return context
}

type FluidTabsRootProps = {
  children: ReactNode
  defaultActiveIndex?: number
  activeIndex?: number
  onActiveIndexChange?: (index: number) => void
  className?: string
}

function FluidTabsRoot({
  children,
  defaultActiveIndex = 0,
  activeIndex: activeIndexProp,
  onActiveIndexChange,
  className,
}: FluidTabsRootProps) {
  const { activeIndex, setActiveIndex, focusedIndex, setFocusedIndex } =
    useTabSelection({
      defaultActiveIndex,
      activeIndex: activeIndexProp,
      onActiveIndexChange,
    })
  const indicatorLayoutId = `fluid-tab-indicator-${useId().replace(/:/g, '')}`

  const rootContext = useMemo(
    () => ({
      activeIndex,
      setActiveIndex,
      focusedIndex,
      setFocusedIndex,
      indicatorLayoutId,
    }),
    [
      activeIndex,
      setActiveIndex,
      focusedIndex,
      setFocusedIndex,
      indicatorLayoutId,
    ]
  )

  return (
    <FluidTabsContext.Provider value={rootContext}>
      <div className={cn(styles.root, className)}>{children}</div>
    </FluidTabsContext.Provider>
  )
}

type FluidTabsListProps = ComponentProps<'nav'> & {
  'aria-label'?: string
}

function FluidTabsList({
  className,
  children,
  'aria-label': ariaLabel = 'Tabs',
  onKeyDown,
  onFocusCapture,
  ...props
}: FluidTabsListProps) {
  const { activeIndex, setActiveIndex, setFocusedIndex } = useFluidTabs()
  const tabs = Children.toArray(children).filter(isValidElement)
  const count = tabs.length

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(styles.list, className)}
      {...props}
    >
      <div
        role="tablist"
        tabIndex={0}
        className={styles.tablist}
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
          <FluidTabSlot key={tab.key ?? index} index={index}>
            {tab}
          </FluidTabSlot>
        ))}
      </div>
    </nav>
  )
}

function FluidTabsIcon({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      aria-hidden={true}
      className={cn(styles.icon, className)}
      {...props}
    />
  )
}

function FluidTabsLabel({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn(styles.label, className)} {...props} />
}

type FluidTabsTabProps = ComponentProps<'button'> & {
  label?: string
}

function FluidTabsTab({
  className,
  children,
  label,
  onClick,
  onFocus,
  ...props
}: FluidTabsTabProps) {
  const { activeIndex, setActiveIndex, setFocusedIndex, indicatorLayoutId } =
    useFluidTabs()
  const { index } = useFluidTabSlot()
  const isSelected = activeIndex === index

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      {...(label ? { 'aria-label': label } : {})}
      className={cn(tabFocusClass(styles.tab), className)}
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
      {isSelected ? (
        <motion.span
          aria-hidden={true}
          layoutId={indicatorLayoutId}
          className={styles.indicator}
          transition={INDICATOR_SPRING}
        />
      ) : null}
      <motion.span
        className={styles.content}
        animate={{ scale: isSelected ? 1 : 0.98 }}
        transition={LABEL_TRANSITION}
      >
        {children}
      </motion.span>
    </button>
  )
}

const FluidTabs = Object.assign(FluidTabsRoot, {
  List: FluidTabsList,
  Tab: FluidTabsTab,
  Icon: FluidTabsIcon,
  Label: FluidTabsLabel,
})

export default FluidTabs
export {
  FluidTabsIcon,
  FluidTabsLabel,
  FluidTabsList,
  FluidTabsRoot,
  FluidTabsTab,
  useFluidTabs,
}
