/* eslint-disable @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions -- Optional presentation-only images fall back on load error; no click interaction. */
import cn from 'classnames'
import { useEffect, useState } from 'react'

import styles from './user-avatar.module.css'

const palette = ['#664780', '#4a3861', '#3f4c67', '#3c584b']

export function UserAvatar({
  username,
  userId,
  image,
  className,
  tone,
}: {
  username: string
  userId?: string
  image?: string
  className?: string
  tone?: 'purple'
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [image])
  const hash = Array.from(userId ?? username).reduce(
    (value, character) =>
      (value * 31 + (character.codePointAt(0) ?? 0)) % 2147483647,
    0
  )
  const color = tone === 'purple' ? palette[0] : palette[hash % palette.length]
  return (
    <div
      className={cn(styles.avatar, className)}
      style={{ backgroundColor: color }}
      data-avatar-color={color}
    >
      {image && !failed ? (
        <img src={image} alt={username} onError={() => setFailed(true)} />
      ) : (
        <span role="img" aria-label={username}>
          {Array.from(username.trim())[0]?.toUpperCase() ?? '?'}
        </span>
      )}
    </div>
  )
}
