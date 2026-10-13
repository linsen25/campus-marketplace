import { domMax, m } from 'framer-motion'

// Framer Motion 6 enumerates renderer features on first module evaluation.
// Initialize that renderer before LazyMotion registers domMax's projection key;
// otherwise a later route's first motion component treats it as a feature.
// This creates a component factory only; it does not mount or change animations.
m('div')

export default domMax
