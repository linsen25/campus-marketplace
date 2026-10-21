'use client'

import { useEffect, useRef, useState } from 'react'

import actionStyles from '@/components/animata/button/action-button-sizing.module.css'
import { ActionRow } from '@/components/ui/action-row'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { UserAvatar } from '@/components/ui/user-avatar'
import { FileDrop } from '@/components/velora/file-drop'
import { profileAvatarRules } from '@/lib/profile-avatar'

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
  onSave: (file: File) => Promise<void> | void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string>()
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
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
          accept="image/jpeg,image/png,image/webp"
          multiple={false}
          showFiles={false}
          files={file ? [file] : []}
          onFiles={(files) => {
            if (saving) return
            if (
              files.length !== 1 ||
              !profileAvatarRules.mimeTypes.includes(files[0].type) ||
              files[0].size <= 0 ||
              files[0].size > profileAvatarRules.maxBytes
            ) {
              setError('Choose a JPEG, PNG, or WebP image up to 3 MB.')
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
        <DynamicAction
          variant="red"
          footer={true}
          showArrow={false}
          onClick={onClose}
        >
          Cancel
        </DynamicAction>
        <DynamicAction
          variant="green"
          footer={true}
          disabled={!file || !ready || saving}
          onClick={async () => {
            if (!file) return
            setSaving(true)
            setError('')
            try {
              await onSave(file)
              if (mounted.current) onClose()
            } catch (reason) {
              if (mounted.current)
                setError(
                  reason instanceof Error
                    ? reason.message
                    : 'Unable to save your avatar. Please retry.'
                )
            } finally {
              if (mounted.current) setSaving(false)
            }
          }}
        >
          Save
        </DynamicAction>
      </ActionRow>
    </FadingDialog>
  )
}
