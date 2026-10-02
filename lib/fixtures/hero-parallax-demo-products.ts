// Visual development only; imported by the homepage SSR function in development.
// Reuse local sample photographs. These are layout samples, not real listings.
const titles = [
  'Desk Lamp',
  'Mini Fridge',
  'Calculus Textbook',
  'Office Chair',
  'Monitor',
  'Rice Cooker',
  'Winter Jacket',
  'Desk',
  'Keyboard',
  'Coffee Table',
  'Bookshelf',
  'Headphones',
  'Backpack',
  'Floor Lamp',
  'Microwave',
  'Bike',
  'Storage Drawers',
  'Gaming Mouse',
  'Kitchen Set',
  'Reading Chair',
  'Study Notes',
]
const images = [
  '/static/images/banners/bags-desktop.jpg',
  '/static/images/banners/tops-desktop.jpg',
  '/static/images/banners/jeans-desktop.jpg',
  '/static/images/banners/scarf-desktop.jpg',
  '/static/images/home/banner.jpg',
]
export const heroParallaxDemoProducts = titles.map((title, index) => ({
  id: `visual-demo-${index + 1}`,
  title,
  image: images[index % images.length],
}))
