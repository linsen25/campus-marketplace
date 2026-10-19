/** Local demo/test photography only. Never a fallback for uploaded Listing media.
 * Provenance: public/static/testPic/SOURCES.md.
 */
export const TEST_PICTURES = {
  chair: '/static/testPic/chair.webp',
  deskChair: '/static/testPic/desk-chair.webp',
  deskLamp: '/static/testPic/desk-lamp.webp',
  monitor: '/static/testPic/monitor.webp',
  textbook: '/static/testPic/textbook.webp',
  controller: '/static/testPic/controller.webp',
  laptop: '/static/testPic/laptop.webp',
  headphones: '/static/testPic/headphones.webp',
  backpack: '/static/testPic/backpack.webp',
  sneakers: '/static/testPic/sneakers.webp',
  keyboard: '/static/testPic/keyboard.webp',
  mouse: '/static/testPic/mouse.webp',
  speaker: '/static/testPic/speaker.webp',
  camera: '/static/testPic/camera.webp',
  bicycle: '/static/testPic/bicycle.webp',
  calculator: '/static/testPic/calculator.webp',
  mug: '/static/testPic/mug.webp',
  plant: '/static/testPic/plant.webp',
  jacket: '/static/testPic/jacket.webp',
  jewelry: '/static/testPic/jewelry.webp',
  workspace: '/static/testPic/workspace.webp',
  bookshelf: '/static/testPic/bookshelf.webp',
  clothingDisplay: '/static/testPic/clothing-display.webp',
  stationery: '/static/testPic/stationery.webp',
  crochetBunny: '/static/testPic/crochet-bunny.webp',
  phoneCase: '/static/testPic/phone-case.webp',
  candle: '/static/testPic/candle.webp',
  toteBag: '/static/testPic/tote-bag.webp',
  bracelet: '/static/testPic/bracelet.webp',
  decorativeTray: '/static/testPic/decorative-tray.webp',
} as const

/** Fixed ordering is part of deterministic generic fixture assignment. */
export const TEST_PICTURE_POOL = Object.freeze(Object.values(TEST_PICTURES))

/** Call only while constructing explicit fixtures, never to classify real records. */
export function testPictureForFixture(fixtureId: string) {
  if (!fixtureId) throw new Error('A stable fixture ID is required')
  let hash = 0
  for (let index = 0; index < fixtureId.length; index++)
    hash = (hash * 31 + fixtureId.charCodeAt(index)) % 4294967296
  return TEST_PICTURE_POOL[hash % TEST_PICTURE_POOL.length]
}
