'use client'

import cn from 'classnames'
import type {
  AnchorHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  RefObject,
} from 'react'
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import styles from './animated-sidebar.module.css'

const SidebarContext = createContext<{
  pinned: boolean
  setPinned: (pinned: boolean) => void
  closeDrawer: () => void
  drawerRef: RefObject<HTMLDialogElement>
}>({
  pinned: false,
  setPinned: () => {},
  closeDrawer: () => {},
  drawerRef: { current: null },
})

interface SidebarProps extends HTMLAttributes<HTMLDivElement> {
  pinned?: boolean
  defaultPinned?: boolean
  onPinnedChange?: (pinned: boolean) => void
}

// CSS Modules translation of the supplied Velora Sidebar source.
export function Sidebar({
  pinned: pinnedProp,
  defaultPinned = false,
  onPinnedChange,
  className,
  children,
  ...props
}: SidebarProps) {
  const [inner, setInner] = useState(defaultPinned)
  const drawerRef = useRef<HTMLDialogElement>(null)
  const pinned = pinnedProp ?? inner
  const setPinned = (next: boolean) => {
    if (pinnedProp === undefined) setInner(next)
    onPinnedChange?.(next)
  }
  return (
    <SidebarContext.Provider
      value={{
        pinned,
        setPinned,
        drawerRef,
        closeDrawer: () => drawerRef.current?.close(),
      }}
    >
      <div
        {...props}
        data-slot="sidebar"
        className={cn(styles.shell, className)}
      >
        <div className={styles.layout}>{children}</div>
      </div>
    </SidebarContext.Provider>
  )
}

export function SidebarBody({
  logo,
  title,
  footer,
  label = 'Main',
  pinnable = true,
  className,
  children,
}: {
  logo?: ReactNode
  title?: ReactNode
  footer?: ReactNode
  label?: string
  pinnable?: boolean
  className?: string
  children: ReactNode
}) {
  const { pinned, setPinned, drawerRef } = useContext(SidebarContext)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!drawerOpen) return undefined
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = ''
    }
  }, [drawerOpen])
  const head = (extra?: ReactNode) => (
    <div className={styles.head}>
      <span className={styles.logo}>{logo}</span>
      <span className={cn(styles.reveal, styles.brand)}>{title}</span>
      {extra}
    </div>
  )
  const links = <div className={styles.links}>{children}</div>
  return (
    <>
      <div data-expanded={true} className={cn(styles.group, styles.topbar)}>
        {head(
          <button
            ref={menuRef}
            type="button"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls={id}
            className={styles.control}
            onClick={() => {
              drawerRef.current?.showModal()
              setDrawerOpen(true)
            }}
          >
            <SidebarIcon path="M4 6h16M4 12h16M4 18h16" />
          </button>
        )}
      </div>
      <div data-expanded={pinned || undefined} className={styles.rail}>
        <nav
          aria-label={label}
          data-slot="sidebar-body"
          data-expanded={pinned || undefined}
          className={cn(styles.panel, styles.group, styles.railNav, className)}
        >
          {head()}
          {links}
          {footer}
          {pinnable && (
            <button
              type="button"
              aria-pressed={pinned}
              className={styles.pin}
              onClick={() => setPinned(!pinned)}
            >
              <span
                className={styles.pinIcon}
                data-pinned={pinned || undefined}
              >
                <SidebarIcon path="m9 6 6 6-6 6" />
              </span>
              <span className={styles.reveal}>Keep expanded</span>
            </button>
          )}
        </nav>
      </div>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Native dialog backdrop handling from the supplied source. */}
      <dialog
        ref={drawerRef}
        id={id}
        aria-label={label}
        className={styles.drawer}
        onClose={() => {
          setDrawerOpen(false)
          menuRef.current?.focus({ preventScroll: true })
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close()
        }}
      >
        <nav
          data-expanded={true}
          className={cn(
            styles.panel,
            styles.group,
            styles.drawerNav,
            className
          )}
        >
          {head(
            <button
              type="button"
              aria-label="Close navigation"
              className={styles.control}
              onClick={() => drawerRef.current?.close()}
            >
              <SidebarIcon path="M18 6 6 18M6 6l12 12" />
            </button>
          )}
          {links}
          {footer}
        </nav>
      </dialog>
    </>
  )
}

function SidebarIcon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={styles.svg}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  )
}

interface SidebarLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
  icon: ReactNode
  label: string
  active?: boolean
}

export function SidebarLink({
  icon,
  label,
  active = false,
  className,
  onClick,
  ...props
}: SidebarLinkProps) {
  const { closeDrawer } = useContext(SidebarContext)
  return (
    <a
      aria-current={active ? 'page' : undefined}
      {...props}
      href={props.href}
      className={cn(styles.link, className)}
      onClick={(event) => {
        onClick?.(event)
        closeDrawer()
      }}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.reveal}>{label}</span>
    </a>
  )
}
