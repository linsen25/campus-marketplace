// Narrow declarations for the existing Sharp 0.30 dependency used by B03.
declare module 'sharp' {
  type Metadata = {
    format?: string
    width?: number
    height?: number
    pages?: number
  }
  interface SharpImage {
    metadata: () => Promise<Metadata>
    rotate: () => SharpImage
    resize: (options: {
      width: number
      height: number
      fit: 'inside'
      withoutEnlargement: boolean
    }) => SharpImage
    webp: (options: { quality: number }) => SharpImage
    toBuffer: () => Promise<Buffer>
  }
  function sharp(
    input: Buffer,
    options: { limitInputPixels: number; failOnError: boolean }
  ): SharpImage
  export = sharp
}
