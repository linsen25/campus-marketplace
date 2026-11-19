import type { CSSProperties } from 'react'

/**
 * Shared motion contract for non-modal floating menus. Keep positioning,
 * focus, and selection semantics in the owning component.
 */
export const dropdownMotion = {
  panelEnter: 0.2,
  panelExit: 0.18,
  contentEnter: 0.25,
  contentExit: 0.14,
  contentDelay: 0.05,
  panelOffset: 4,
  contentOffset: 40,
  panelScale: 0.95,
  itemDelay: 0.025,
  itemDelayOffset: 8,
  chevronDuration: 0.16,
  chevronEase: 'ease' as const,
  ease: [0.215, 0.61, 0.355, 1] as const,
  popEase: 'easeOut' as const,
}

export function dropdownMotionVars(reduced: boolean): CSSProperties {
  return {
    '--dropdown-panel-enter': `${reduced ? 0 : dropdownMotion.panelEnter}s`,
    '--dropdown-panel-exit': `${reduced ? 0 : dropdownMotion.panelExit}s`,
    '--dropdown-content-enter': `${reduced ? 0 : dropdownMotion.contentEnter}s`,
    '--dropdown-content-exit': `${reduced ? 0 : dropdownMotion.contentExit}s`,
    '--dropdown-content-delay': `${reduced ? 0 : dropdownMotion.contentDelay}s`,
    '--dropdown-panel-offset': `${reduced ? 0 : dropdownMotion.panelOffset}px`,
    '--dropdown-content-offset': `${
      reduced ? 0 : dropdownMotion.contentOffset
    }px`,
    '--dropdown-panel-scale': reduced ? 1 : dropdownMotion.panelScale,
    '--dropdown-chevron-duration': `${
      reduced ? 0 : dropdownMotion.chevronDuration
    }s`,
    '--dropdown-chevron-ease': dropdownMotion.chevronEase,
  } as CSSProperties
}

export function dropdownPanelTransition(reduced: boolean, closing: boolean) {
  return {
    duration: reduced
      ? 0
      : closing
      ? dropdownMotion.panelExit
      : dropdownMotion.panelEnter,
    ease: dropdownMotion.popEase,
  }
}

export function dropdownContentTransition(reduced: boolean, closing: boolean) {
  return {
    duration: reduced
      ? 0
      : closing
      ? dropdownMotion.contentExit
      : dropdownMotion.contentEnter,
    delay: reduced || closing ? 0 : dropdownMotion.contentDelay,
    ease: dropdownMotion.ease,
  }
}
