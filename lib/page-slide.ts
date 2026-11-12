export const pageSlideTiming = {
  mobile: {
    duration: 0.32,
    easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    motionEase: [0.22, 0.61, 0.36, 1] as const,
  },
  desktop: {
    duration: 0.38,
    easing: 'cubic-bezier(0.42, 0, 1, 1)',
    motionEase: [0.42, 0, 1, 1] as const,
  },
} as const

/** Shared physical-track timing for Market/Home and local Messages navigation. */
export function pageSlideOptions(
  mobile: boolean,
  reduced: boolean
): KeyframeAnimationOptions {
  const timing = mobile ? pageSlideTiming.mobile : pageSlideTiming.desktop
  return {
    duration: reduced ? 60 : timing.duration * 1000,
    easing: timing.easing,
    fill: 'forwards',
  }
}

export function pageSlideMotionTransition(mobile: boolean, reduced: boolean) {
  const timing = mobile ? pageSlideTiming.mobile : pageSlideTiming.desktop
  return {
    duration: reduced ? 0.06 : timing.duration,
    ease: timing.motionEase,
  } as const
}
