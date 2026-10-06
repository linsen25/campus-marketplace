declare module 'canvas-confetti' {
  export interface Options {
    particleCount?: number
    spread?: number
    startVelocity?: number
    gravity?: number
    ticks?: number
    scalar?: number
    colors?: string[]
    origin?: { x: number; y: number }
    disableForReducedMotion?: boolean
  }
  export interface GlobalOptions {
    resize?: boolean
    useWorker?: boolean
    disableForReducedMotion?: boolean
  }
  export interface CreateTypes {
    (options?: Options): Promise<null> | null
    reset: () => void
  }
  const confetti: CreateTypes & {
    create: (canvas: HTMLCanvasElement, options?: GlobalOptions) => CreateTypes
  }
  export default confetti
}
