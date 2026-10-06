/* eslint jsx-a11y/no-onchange: off -- Files update local listing state only. */
'use client'

import cn from 'classnames'
import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'

import styles from './file-drop.module.css'

interface FileDropProps {
  showFiles?: boolean
  children?: ReactNode
  onFiles?: (files: File[]) => void
  accept?: string
  multiple?: boolean
  className?: string
  inputRef?: RefObject<HTMLInputElement>
  files: File[]
  disabled?: boolean
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function FileDrop({
  showFiles = true,
  children,
  onFiles,
  accept,
  multiple = true,
  className,
  inputRef,
  files,
  disabled = false,
}: FileDropProps) {
  const [over, setOver] = useState(false)
  const acceptFiles = (list: FileList | null) => {
    if (disabled || !list?.length) return
    onFiles?.(Array.from(list))
  }
  return (
    <div className={cn(styles.fileDrop, className)} data-slot="file-drop">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Native input label also receives file drag/drop. */}
      <label
        className={cn(styles.zone, over && styles.over)}
        data-over={over}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setOver(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setOver(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          acceptFiles(event.dataTransfer.files)
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden={true}
          className={styles.icon}
        >
          <path d="M12 15V3M8 7l4-4 4 4" />
          <path d="M3 15v4a2 2 0 002 2h14a2 2 0 002-2v-4" />
        </svg>
        <span className={styles.title}>
          {over ? 'Drop to upload' : 'Drag files here, or click to browse'}
        </span>
        <span className={styles.hint}>
          {accept ? accept.replace(/,/g, ', ') : 'Any file type'}
        </span>
        <input
          ref={inputRef}
          id="listing-photos"
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className={styles.input}
          aria-label="Photos"
          onChange={(event) => {
            acceptFiles(event.target.files)
            const input = event.currentTarget
            input.value = ''
          }}
        />
      </label>
      {children}
      {showFiles && files.length > 0 && (
        <ul className={styles.files}>
          {files.map((file, index) => (
            // eslint-disable-next-line react/no-array-index-key -- Identical local files are allowed; distinguish duplicate selection entries.
            <li key={`${file.name}-${file.size}-${index}`}>
              <span className={styles.name}>{file.name}</span>
              <span className={styles.size}>{formatSize(file.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
