type DriftItem = { image: string; title: string; href: string }
export default function DriftWall(props: {
  items: DriftItem[]
  [key: string]: unknown
}): JSX.Element
