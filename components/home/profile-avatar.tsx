'use client'

import { useEffect, useState } from 'react'

import actionStyles from '@/components/animata/button/action-button-sizing.module.css'
import { CardAction } from '@/components/listings/card-actions'
import { ActionRow } from '@/components/ui/action-row'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { UserAvatar } from '@/components/ui/user-avatar'
import { FileDrop } from '@/components/velora/file-drop'

import styles from './profile.module.css'

export function ProfileAvatar({
  username,
  image,
  preview = false,
}: {
  username: string
  image?: string
  preview?: boolean
}) {
  return (
    <div className={preview ? styles.avatarPreview : styles.profileAvatar}>
      <UserAvatar username={username} image={image} tone="purple" />
    </div>
  )
}

export function AvatarDialog({
  username,
  onClose,
  onSave,
}: {
  username: string
  onClose: () => void
  onSave: (file: File) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string>()
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!file) return undefined
    const url = URL.createObjectURL(file)
    const probe = new Image()
    probe.onload = () => setReady(true)
    probe.onerror = () =>
      setError('This image could not be opened. Select another image.')
    probe.src = url
    setPreview(url)
    return () => {
      probe.onload = null
      probe.onerror = null
      URL.revokeObjectURL(url)
    }
  }, [file])

  return (
    <FadingDialog
      className={`${styles.dialog} ${actionStyles.contract}`}
      aria-labelledby="profile-avatar-title"
      onRequestClose={onClose}
    >
      <h3 id="profile-avatar-title">Set avatar</h3>
      <div className={styles.avatarUpload}>
        <FileDrop
          inputId="profile-avatar-file"
          inputLabel="Avatar image"
          accept="image/*"
          multiple={false}
          showFiles={false}
          files={file ? [file] : []}
          onFiles={(files) => {
            if (files.length !== 1 || !files[0].type.startsWith('image/')) {
              setError('Select one image only.')
              return
            }
            setError('')
            setReady(false)
            setFile(files[0])
          }}
        >
          {preview && (
            <div className={styles.avatarSelection}>
              <ProfileAvatar
                username={username}
                image={preview}
                preview={true}
              />
              <span>{file?.name}</span>
            </div>
          )}
        </FileDrop>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <ActionRow>
        <CardAction onClick={onClose}>Cancel</CardAction>
        <DynamicAction
          variant="green"
          footer={true}
          disabled={!file || !ready}
          onClick={() => {
            if (!file) return
            onSave(file)
            onClose()
          }}
        >
          Save
        </DynamicAction>
      </ActionRow>
    </FadingDialog>
  )
}
