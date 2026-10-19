import { TEST_PICTURES } from './test-pictures'

// Visual development only; imported by the homepage SSR function in development.
// Reuse local sample photographs. These are layout samples, not real listings.
const items = [
  ['Laptop and study essentials', TEST_PICTURES.laptop],
  ['24-inch monitor', TEST_PICTURES.monitor],
  ['Compact keyboard', TEST_PICTURES.keyboard],
  ['Wireless headphones', TEST_PICTURES.headphones],
  ['Desk workspace', TEST_PICTURES.workspace],
  ['Office chair', TEST_PICTURES.deskChair],
  ['Desk lamp', TEST_PICTURES.deskLamp],
  ['Portable speaker', TEST_PICTURES.speaker],
  ['Ceramic mug', TEST_PICTURES.mug],
  ['Decorative tray', TEST_PICTURES.decorativeTray],
  ['Study book bundle', TEST_PICTURES.textbook],
  ['Scientific calculator', TEST_PICTURES.calculator],
  ['Campus backpack', TEST_PICTURES.backpack],
  ['Winter jacket', TEST_PICTURES.jacket],
  ['Canvas sneakers', TEST_PICTURES.sneakers],
  ['Camera', TEST_PICTURES.camera],
  ['Wooden accent chair', TEST_PICTURES.chair],
  ['Commuter bike', TEST_PICTURES.bicycle],
  ['Potted plant', TEST_PICTURES.plant],
  ['Protective phone case', TEST_PICTURES.phoneCase],
  ['Wireless controller', TEST_PICTURES.controller],
] as const
export const heroParallaxDemoProducts = items.map(([title, image], index) => ({
  id: `visual-demo-${index + 1}`,
  title,
  image,
}))
