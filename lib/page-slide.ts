/** Shared physical-track timing for Market/Home and local Messages navigation. */
export function pageSlideOptions(
  mobile: boolean,
  reduced: boolean
): KeyframeAnimationOptions {
  const duration = mobile ? 320 : 380
  return {
    duration: reduced ? 60 : duration,
    easing: mobile
      ? 'cubic-bezier(0.22, 0.61, 0.36, 1)'
      : 'cubic-bezier(0.42, 0, 1, 1)',
    fill: 'forwards',
  }
}
