'use client'

import confetti from 'canvas-confetti'
import type { CreateTypes, GlobalOptions, Options } from 'canvas-confetti'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'

export type ConfettiRef = { fire: (options?: Options) => Promise<void> }

/** Supplied canvas-confetti canvas adapter; manual fire and unmount cleanup. */
export const Confetti = forwardRef<
  ConfettiRef,
  React.ComponentPropsWithoutRef<'canvas'> & {
    options?: Options
    globalOptions?: GlobalOptions
    manualstart?: boolean
  }
>(({ options, globalOptions, manualstart = false, ...props }, ref) => {
  const canvas = useRef<HTMLCanvasElement>(null)
  const instance = useRef<CreateTypes | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const globals = useRef(globalOptions)
  useEffect(() => {
    if (canvas.current)
      instance.current = confetti.create(canvas.current, {
        resize: true,
        useWorker: true,
        ...globals.current,
      })
    return () => {
      instance.current?.reset()
      instance.current = null
    }
  }, [])
  const fire = useCallback(async (next: Options = {}) => {
    await instance.current?.({ ...optionsRef.current, ...next })
  }, [])
  useImperativeHandle(ref, () => ({ fire }), [fire])
  useEffect(() => {
    if (!manualstart) fire().catch(() => {})
  }, [manualstart, fire])
  return <canvas {...props} ref={canvas} />
})
Confetti.displayName = 'Confetti'
