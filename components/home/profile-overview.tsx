'use client'

import { AnimatePresence } from 'framer-motion'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import actionStyles from '@/components/animata/button/action-button-sizing.module.css'
import { CardAction } from '@/components/listings/card-actions'
import { ContentStateRegion } from '@/components/listings/workspace-empty'
import { ActionRow } from '@/components/ui/action-row'
import { ContentLoadingSpinner } from '@/components/ui/content-loading-spinner'
import { useContentReveal } from '@/components/ui/content-reveal'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { passwordRules } from '@/lib/auth-password'
import { reservedUsername, validUsername } from '@/lib/auth-username'
import { marketplaceRequest } from '@/lib/listings-api'

import styles from './profile.module.css'

export function ProfileAction({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <CardAction disabled={disabled} onClick={onClick}>
      {children}
    </CardAction>
  )
}

function SettingsChange({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <DynamicAction
      footer={true}
      variant="red"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </DynamicAction>
  )
}

// eslint-disable-next-line complexity -- Two forms share the existing dialog and canonical rule rows.
function ChangeDialog({
  kind,
  username,
  onClose,
  onSaved,
  nextAllowedAt,
}: {
  kind: 'password' | 'username'
  username: string
  onClose: () => void
  onSaved: (username: string, next: string | null) => void
  nextAllowedAt: string | null
}) {
  const [value, setValue] = useState(kind === 'username' ? username : '')
  const [confirmation, setConfirmation] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [cooldownBlocked, setCooldownBlocked] = useState(false)
  async function saveUsername() {
    setSaving(true)
    setSaveError('')
    try {
      const result = await marketplaceRequest<{
        username: string
        next_change_allowed_at: string | null
      }>('/api/profile/username', 'POST', { username: value })
      onSaved(result.username, result.next_change_allowed_at)
      onClose()
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : 'Unable to change username.'
      setSaveError(message)
      if (message.startsWith('You can change your username again'))
        setCooldownBlocked(true)
    } finally {
      setSaving(false)
    }
  }
  const [availability, setAvailability] = useState<boolean | null>(null)
  const [availabilityError, setAvailabilityError] = useState('')
  useEffect(() => {
    let active = true
    setAvailability(null)
    setAvailabilityError('')
    if (kind !== 'username' || !validUsername(value) || reservedUsername(value))
      return undefined
    const timer = setTimeout(() => {
      marketplaceRequest<{ available: boolean }>(
        `/api/auth/username-availability?username=${encodeURIComponent(value)}`,
        'GET'
      )
        .then((data) => {
          if (active) setAvailability(data.available)
        })
        .catch(() => {
          if (active)
            setAvailabilityError('Availability unavailable. Please try again.')
        })
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [kind, value])
  const cooldown = Boolean(
    nextAllowedAt && Date.parse(nextAllowedAt) > Date.now()
  )
  let availabilityLabel = 'Availability not yet confirmed'
  if (availability !== null)
    availabilityLabel = availability
      ? 'Username available (case-insensitive)'
      : 'Username unavailable (case-insensitive)'
  if (availabilityError) availabilityLabel = availabilityError
  const title = kind === 'username' ? 'Change username' : 'Change password'
  return (
    <FadingDialog
      className={`${styles.dialog} ${actionStyles.contract}`}
      aria-labelledby="profile-change-title"
      onRequestClose={onClose}
    >
      <h3 id="profile-change-title">{title}</h3>
      {kind === 'password' && (
        <label className={styles.field}>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
      )}
      <label className={styles.field}>
        {kind === 'username' ? 'Username' : 'New password'}
        <input
          type={kind === 'username' ? 'text' : 'password'}
          value={value}
          autoComplete={kind === 'username' ? 'username' : 'new-password'}
          maxLength={kind === 'username' ? 20 : undefined}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      {kind === 'password' && (
        <>
          <ul className={styles.rules}>
            {passwordRules.map((rule) => (
              <li key={rule.label} data-met={rule.test(value) || undefined}>
                {rule.label}
              </li>
            ))}
          </ul>
          <label className={styles.field}>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {confirmation && value === confirmation && (
            <p className={styles.valid}>Passwords match.</p>
          )}
          {confirmation && value !== confirmation && (
            <p className={styles.error}>Passwords do not match.</p>
          )}
        </>
      )}
      {kind === 'username' && (
        <>
          <ul className={styles.rules}>
            <li
              data-met={(value.length >= 3 && value.length <= 20) || undefined}
            >
              3-20 characters
            </li>
            <li data-met={/^[A-Za-z0-9_]+$/.test(value) || undefined}>
              Letters, numbers, underscore only
            </li>
            <li
              data-met={
                (Boolean(value) && !reservedUsername(value)) || undefined
              }
            >
              Not a reserved name
            </li>
            <li data-met={availability === true || undefined}>
              {availabilityLabel}
            </li>
          </ul>
          <p className={styles.caption}>
            {cooldown && nextAllowedAt
              ? `Username changes available ${new Date(
                  nextAllowedAt
                ).toLocaleDateString('en-US')}`
              : 'Username changes are subject to the marketplace cooldown.'}
          </p>
        </>
      )}
      {kind === 'password' && (
        <p className={styles.notice} role="status">
          Password changes are currently unavailable. Your password has not been
          changed.
        </p>
      )}
      {saveError && (
        <p className={styles.error} role="alert">
          {saveError}
        </p>
      )}
      <ActionRow>
        <ProfileAction disabled={saving} onClick={onClose}>
          Cancel
        </ProfileAction>
        <DynamicAction
          variant="green"
          footer={true}
          disabled={
            kind === 'password' ||
            saving ||
            cooldown ||
            cooldownBlocked ||
            availability !== true
          }
          onClick={() => {
            saveUsername()
          }}
        >
          {saving ? 'Saving...' : 'Save'}
        </DynamicAction>
      </ActionRow>
    </FadingDialog>
  )
}

export function ProfileOverview({
  showHeading = true,
  onUsername,
  settings = false,
  sessionAction,
}: {
  settings?: boolean
  sessionAction?: ReactNode
  showHeading?: boolean
  onUsername?: (username: string | null) => void
}) {
  const [account, setAccount] = useState<{
    username: string | null
    email: string
    emailVerified: boolean
    createdAt: string
    nextUsernameChangeAt: string | null
  } | null>(null)
  const [error, setError] = useState('')
  const unavailable = 'Unavailable'
  const loading = !account && !error
  const reveal = useContentReveal(loading)
  const [dialog, setDialog] = useState<'password' | 'username' | null>(null)
  useEffect(() => {
    let active = true
    marketplaceRequest<{
      username: string | null
      email: string
      emailVerified: boolean
      createdAt: string
      nextUsernameChangeAt: string | null
    }>('/api/profile/account', 'GET')
      .then((data) => {
        if (active) {
          setAccount(data)
          onUsername?.(data.username)
        }
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Unable to load account information.'
          )
      })
    return () => {
      active = false
    }
  }, [onUsername])
  if (loading)
    return (
      <ContentStateRegion>
        <ContentLoadingSpinner />
      </ContentStateRegion>
    )
  return (
    <section
      className={`${reveal} ${styles.panel} ${styles.overview} ${
        settings ? styles.settings : ''
      } ${actionStyles.contract}`}
      aria-label={settings ? 'Account & Security' : 'Overview'}
    >
      {showHeading && (
        <header className={styles.panelHeader}>
          <h3>{settings ? 'Account & Security' : 'Overview'}</h3>
        </header>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.accountRow}>
        <div>
          <span className={styles.fieldLabel}>Username</span>
          <p>{account ? account.username ?? 'Not claimed' : unavailable}</p>
        </div>
        {settings && (
          <SettingsChange
            disabled={!account}
            onClick={() => setDialog('username')}
          >
            Change username
          </SettingsChange>
        )}
      </div>
      {!settings && (
        <>
          <div className={styles.accountRow}>
            <div>
              <span className={styles.fieldLabel}>Western Email</span>
              <p>{account?.email ?? unavailable}</p>
            </div>
            <span
              className={
                account?.emailVerified ? styles.verified : styles.readOnly
              }
            >
              {account?.emailVerified ? 'Verified' : 'Read-only'}
            </span>
          </div>
          <div className={styles.accountRow}>
            <div>
              <span className={styles.fieldLabel}>Member since</span>
              <p>
                {account?.createdAt
                  ? new Date(account.createdAt).toLocaleDateString('en-US', {
                      month: 'long',
                      year: 'numeric',
                    })
                  : unavailable}
              </p>
            </div>
          </div>
        </>
      )}
      {settings && (
        <>
          <div className={styles.accountRow}>
            <div>
              <span className={styles.fieldLabel}>Password</span>
              <p aria-label="Password hidden">{'\u2022'.repeat(8)}</p>
            </div>
            <SettingsChange
              disabled={!account}
              onClick={() => setDialog('password')}
            >
              Change password
            </SettingsChange>
          </div>
          <div className={styles.accountRow}>
            <div>
              <span className={styles.fieldLabel}>Session</span>
            </div>
            {sessionAction}
          </div>
        </>
      )}
      <AnimatePresence>
        {dialog && (
          <ChangeDialog
            kind={dialog}
            nextAllowedAt={account?.nextUsernameChangeAt ?? null}
            username={account?.username ?? ''}
            onClose={() => setDialog(null)}
            onSaved={(name, next) => {
              setAccount((current) =>
                current
                  ? { ...current, username: name, nextUsernameChangeAt: next }
                  : current
              )
              onUsername?.(name)
            }}
          />
        )}
      </AnimatePresence>
    </section>
  )
}
