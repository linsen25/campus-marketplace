import { CheckIcon, CircleIcon, EyeIcon, EyeOffIcon, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { FocusEvent, FormEvent, ReactNode, RefObject } from 'react'
import { useEffect, useId, useRef, useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import ShiftTabs from '@/components/animata/tabs/shift-tabs'
import { useUsernameAvailability } from '@/components/auth/use-username-availability'
import HoldButton from '@/components/react-bits/hold-button/hold-button'
import { StatefulButton } from '@/components/velora/stateful-button'
import {
  passwordRules as RULES,
  validSignupPassword,
} from '@/lib/auth-password'
import {
  usernameInvalidMessage,
  usernameTakenMessage,
  usernameReservedMessage,
  reservedUsername,
  validUsername,
} from '@/lib/auth-username'
import { marketplaceRequest } from '@/lib/listings-api'
import { isWesternEmail } from '@/lib/marketplace-auth'

import styles from './auth-signup-card.module.css'

const standards = [
  [
    'Marketplace relevance',
    'Listings must relate to buying, selling, giving away, or exchanging appropriate goods within the Western community. No spam or unrelated promotion.',
  ],
  [
    'Sexual or explicit content',
    'Pornographic, sexually explicit, or sexually exploitative content is prohibited.',
  ],
  [
    'Violence and dangerous goods',
    'No threats, promotion of violence, weapons, or prohibited dangerous goods.',
  ],
  [
    'Drugs and controlled substances',
    'No illegal or recreational drugs, prohibited controlled substances, or prohibited drug-related goods.',
  ],
  [
    'Fraud and prohibited goods',
    'No scams, stolen or counterfeit goods, deliberately misleading listings, or attempts to bypass marketplace safeguards.',
  ],
  [
    'Respect and privacy',
    'No harassment, hate, threats, doxxing, or publishing another person’s private information without permission.',
  ],
  [
    'Enforcement',
    'Violating content may be removed and accounts may be restricted where appropriate.',
  ],
]

const modeCopy = {
  signin: {
    title: 'Welcome back',
    subtitle: 'Log in with your Western email.',
    submit: 'Log in',
    action: 'sign-in',
    minLength: undefined,
  },
  signup: {
    title: 'Create your account',
    subtitle: 'Join the Western community marketplace.',
    submit: 'Create account',
    action: 'verify-signup',
    minLength: 8,
  },
  recovery: {
    title: 'Reset your password',
    subtitle: 'Request a code to choose a new password.',
    submit: 'Save password',
    action: 'reset-password',
    minLength: 8,
  },
}

const signupPasswordErrors = new Set([
  'Password does not meet the required security rules.',
  'Your password must meet all four requirements.',
  'Password must meet all requirements.',
])

function getPasswordFeedback(
  mode: keyof typeof modeCopy,
  password: string,
  attempted: boolean,
  id: string
) {
  const invalid =
    mode === 'signup' && attempted && !validSignupPassword(password)
  const describedBy =
    mode === 'signin'
      ? undefined
      : `${id}-rules${invalid ? ` ${id}-password-error` : ''}`
  return { invalid: invalid || undefined, describedBy }
}

function getModePresentation(
  switching: boolean,
  busy: string,
  reduced: boolean | null
) {
  return {
    disabled: Boolean(busy) || switching,
    phase: switching ? 'hidden' : 'visible',
    variants: {
      visible: {
        opacity: 1,
        transition: { duration: reduced ? 0 : 0.18, ease: 'easeOut' as const },
      },
      hidden: {
        opacity: 0,
        transition: { duration: reduced ? 0 : 0.14, ease: 'easeOut' as const },
      },
    },
  }
}

function FieldHelp({
  active,
  id,
  children,
}: {
  active: boolean
  id: string
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const duration = active ? 0.2 : 0.14
  return (
    <motion.div
      id={id}
      className={styles.contextHelp}
      aria-hidden={!active}
      data-help-open={active ? '' : undefined}
      initial={false}
      animate={{
        height: active ? 'auto' : 0,
        opacity: active ? 1 : 0,
        marginTop: active ? 0 : -8,
      }}
      transition={{
        duration: reduced ? 0 : duration,
        ease: 'easeOut',
      }}
    >
      <div className={styles.contextContent}>{children}</div>
    </motion.div>
  )
}

function UsernameHelp({ value }: { value: string }) {
  const rules = [
    { label: '3–20 characters', met: value.length >= 3 && value.length <= 20 },
    {
      label: 'Letters, numbers, and underscores only.',
      met: /^[A-Za-z0-9_]+$/.test(value),
    },
  ]
  return (
    <ul className={styles.usernameRules} aria-live="polite">
      {rules.map((rule) => (
        <li key={rule.label} className={rule.met ? styles.met : undefined}>
          {rule.met ? (
            <CheckIcon aria-hidden={true} />
          ) : (
            <CircleIcon aria-hidden={true} />
          )}
          {rule.label}
          <span className={styles.srOnly}>
            {rule.met ? ' (satisfied)' : ' (not yet met)'}
          </span>
        </li>
      ))}
    </ul>
  )
}

function UsernameField({
  visible,
  id,
  value,
  disabled,
  active,
  onChange,
  availability,
}: {
  visible: boolean
  id: string
  value: string
  disabled: boolean
  active: boolean
  onChange: (value: string) => void
  availability: { state: string; message?: string }
}) {
  if (!visible) return null
  return (
    <div className={styles.field} data-help-field="username">
      <label htmlFor="signup-username">Username</label>
      <input
        className={styles.input}
        id="signup-username"
        name="signup-username"
        autoComplete="section-signup username"
        value={value}
        disabled={disabled}
        aria-describedby={`${id}-username-help`}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldHelp id={`${id}-username-help`} active={active}>
        <UsernameHelp value={value} />
        {value && !validUsername(value) && (
          <p className={styles.error}>{usernameInvalidMessage}</p>
        )}
        {availability.message && (
          <p
            role="status"
            className={
              availability.state === 'available' ? styles.status : styles.helper
            }
          >
            {availability.message}
          </p>
        )}
      </FieldHelp>
    </div>
  )
}

type HelpField = 'password' | 'username'

function focusedHelpField(target: EventTarget, current: HelpField | null) {
  const field = (target as HTMLElement).closest<HTMLElement>(
    '[data-help-field]'
  )
  if (field) return field.dataset.helpField as HelpField
  // Only another primary input changes context. Action-button focus must not
  // move the Hold Button out from under the pointer during its gesture.
  return (target as HTMLElement).tagName === 'INPUT' ? null : current
}

function signupUsername(mode: keyof typeof modeCopy, username: string) {
  return mode === 'signup' ? { username } : {}
}

function sendCodeLabel(sent: boolean, cooldown: number, busy: string) {
  if (busy === 'send') return 'Sending…'
  if (cooldown > 0) return `Resend in ${cooldown}s`
  return sent ? 'Resend code' : 'Send code'
}

function sendCodeDisabled(switching: boolean, busy: string, cooldown: number) {
  return switching || busy === 'submit' || cooldown > 0
}

function AuthModeTabs({
  mode,
  busy,
  onSelect,
}: {
  mode: keyof typeof modeCopy
  busy: string
  onSelect: (mode: keyof typeof modeCopy) => void
}) {
  return (
    <ShiftTabs
      className={styles.modeTabs}
      activeIndex={mode === 'signup' ? 1 : 0}
      onActiveIndexChange={(index) => {
        if (!busy) onSelect(index === 0 ? 'signin' : 'signup')
      }}
    >
      <ShiftTabs.List aria-label="Authentication mode">
        <ShiftTabs.Tab disabled={Boolean(busy)}>
          <ShiftTabs.Label>Log in</ShiftTabs.Label>
        </ShiftTabs.Tab>
        <ShiftTabs.Tab disabled={Boolean(busy)}>
          <ShiftTabs.Label>Sign up</ShiftTabs.Label>
        </ShiftTabs.Tab>
      </ShiftTabs.List>
    </ShiftTabs>
  )
}

function AuthSubmit({
  mode,
  disabled,
  busy,
  label,
  form,
}: {
  mode: keyof typeof modeCopy
  disabled: boolean
  busy: string
  label: string
  form: RefObject<HTMLFormElement>
}) {
  if (mode === 'signup')
    return (
      <HoldButton
        className={styles.holdSubmit}
        disabled={disabled}
        holdTime={1000}
        doneLabel="Create account"
        onHold={() => form.current?.requestSubmit()}
      >
        Hold to create account
      </HoldButton>
    )
  if (mode === 'signin')
    return (
      <div className={styles.loginAction}>
        <ShiningButton
          variant="green"
          desktopAppearance={true}
          disabled={disabled}
          onClick={() => form.current?.requestSubmit()}
        >
          {busy === 'submit' ? 'Please wait…' : 'Log in'}
        </ShiningButton>
      </div>
    )
  return (
    <button type="submit" className={styles.primary} disabled={disabled}>
      {busy === 'submit' ? 'Please wait…' : label}
    </button>
  )
}

function CommunityStandards({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="community-standards-title"
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onKeyDownCapture={(event) => {
        event.stopPropagation()
        if (event.key === 'Tab') {
          event.preventDefault()
          ref.current?.querySelector('button')?.focus()
        }
      }}
    >
      <section className={styles.standards}>
        <h2 id="community-standards-title">
          Campus Marketplace Community Standards
        </h2>
        {standards.map(([title, copy]) => (
          <div key={title}>
            <h3>{title}</h3>
            <p>{copy}</p>
          </div>
        ))}
        <button type="button" className={styles.primary} onClick={onClose}>
          Back to sign up
        </button>
      </section>
    </dialog>
  )
}

// Adapted from the user's Velora AuthSignupCard source. Retains its header/card/
// field structure, reveal control, progress bars, checklist and agreement row.
// eslint-disable-next-line complexity -- Existing multi-mode form and local readiness feedback share controlled field state.
export function AuthSignupCard({
  initialMode,
  onClose,
  onAuthenticated,
  initialError = '',
}: {
  initialMode: 'signin' | 'signup'
  onClose: () => void
  onAuthenticated: (mode: keyof typeof modeCopy) => Promise<void>
  initialError?: string
}) {
  const id = useId()
  const [mode, setMode] = useState<'recovery' | 'signin' | 'signup'>(
    initialMode
  )
  const [requestedMode, setRequestedMode] = useState(mode)
  const fieldPrefix = { signin: 'login', signup: 'signup', recovery: id }[mode]
  const switching = requestedMode !== mode
  const reduced = useReducedMotion()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [activeHelpField, setActiveHelpField] = useState<HelpField | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [agreement, setAgreement] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [sentEmail, setSentEmail] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [busy, setBusy] = useState('')
  const availability = useUsernameAvailability(
    username,
    mode === 'signup' && !sentEmail
  )
  const [sendError, setSendError] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const {
    disabled: formDisabled,
    phase,
    variants: contentVariants,
  } = getModePresentation(switching, busy, reduced)
  const [error, setError] = useState(initialError)
  const [status, setStatus] = useState('')
  const [showStandards, setShowStandards] = useState(false)
  const [passwordError, setPasswordError] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const pending = useRef(false)
  const passed = RULES.filter((rule) => rule.test(password)).length
  const { invalid: showPasswordError, describedBy: passwordDescription } =
    getPasswordFeedback(mode, password, passwordError, id)
  const normalizedEmail = email.trim().toLowerCase()
  const sent = sentEmail === normalizedEmail && Boolean(sentEmail)
  const missing = [
    !isWesternEmail(email) && 'Use a valid Western email.',
    (!validUsername(username) || reservedUsername(username)) &&
      'Choose a valid, non-reserved username.',
    !sent &&
      availability.state !== 'available' &&
      'Check that your username is available.',
    !validSignupPassword(password) && 'Password must meet all requirements.',
    (!sent || !/^\d{6,10}$/.test(code.trim())) &&
      'Send a verification code and enter it.',
    !agreement && 'Agree to the Marketplace rules.',
  ].filter(Boolean) as string[]
  const signupReady = missing.length === 0
  useEffect(() => {
    if (!cooldown) return undefined
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])
  function switchMode(next: typeof mode) {
    setMode(next)
    setActiveHelpField(null)
    setError('')
    setStatus('')
    setSendError('')
    setCode('')
    setSentEmail('')
    setPassword('')
    setShowPassword(false)
    setPasswordError(false)
  }
  function validateEmail() {
    if (!isWesternEmail(email))
      throw new Error('Use your Western email to continue.')
  }
  function validateSignup() {
    if (!validUsername(username)) throw new Error(usernameInvalidMessage)
    if (reservedUsername(username)) throw new Error(usernameReservedMessage)
    if (!sent && availability.state === 'taken')
      throw new Error(usernameTakenMessage)
    if (!validSignupPassword(password)) {
      setPasswordError(true)
      return false
    }
    if (!agreement)
      throw new Error('Agree to the Campus Marketplace rules to continue.')
    return true
  }
  async function run(
    action: string,
    task: () => Promise<void>,
    propagate = false
  ) {
    if (pending.current) return
    pending.current = true
    setBusy(action)
    setError('')
    setStatus('')
    setSendError('')
    try {
      await task()
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : 'Authentication failed. Please try again.'
      if (action === 'send') setSendError(message)
      else setError(message)
      if (propagate) throw cause
    } finally {
      pending.current = false
      setBusy('')
    }
  }
  const sendCode = async () => {
    await run(
      'send',
      async () => {
        validateEmail()
        if (mode === 'signup' && !validateSignup())
          throw new Error('Password must meet all requirements.')
        const sendAction = mode === 'recovery' ? 'recover' : 'signup-code'
        await marketplaceRequest(
          `/api/auth/${
            mode === 'signup' && sent ? 'resend-signup' : sendAction
          }`,
          'POST',
          {
            email: normalizedEmail,
            password,
            agreement,
            ...signupUsername(mode, username),
          }
        )
        setSentEmail(normalizedEmail)
        setCooldown(60)
        setStatus(
          mode === 'recovery'
            ? 'If this account exists, a recovery code has been sent. Check your inbox.'
            : 'Verification code sent. Check your inbox.'
        )
      },
      true
    )
  }
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mode === 'signup' && !signupReady) {
      setAttempted(true)
      setPasswordError(!validSignupPassword(password))
      return
    }
    if (mode === 'signup' && !validSignupPassword(password)) {
      setPasswordError(true)
      setError('')
      return
    }
    await run('submit', async () => {
      validateEmail()
      if (!password) throw new Error('Enter your password.')
      if (mode === 'signup' && !validateSignup()) return
      if (mode !== 'signin' && (!sent || !/^\d{6,10}$/.test(code.trim())))
        throw new Error('Send a code and enter it from your email.')
      if (mode === 'recovery' && passed !== 4)
        throw new Error('Your password must meet all four requirements.')
      await marketplaceRequest(`/api/auth/${modeCopy[mode].action}`, 'POST', {
        email: normalizedEmail,
        password,
        code: code.trim(),
        agreement,
        ...signupUsername(mode, username),
      })
      await onAuthenticated(mode)
    })
  }
  const { title, subtitle, submit } = modeCopy[mode]
  const sendLabel = sendCodeLabel(sent, cooldown, busy)
  return (
    <section className={styles.composition}>
      <div className={styles.header}>
        <span className={styles.brand}>Campus Marketplace</span>
        <button
          type="button"
          className={styles.dismiss}
          aria-label="Close authentication"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <motion.h2
          id="auth-title"
          initial={false}
          animate={phase}
          variants={contentVariants}
        >
          {title}
        </motion.h2>
        <motion.p initial={false} animate={phase} variants={contentVariants}>
          {subtitle}
        </motion.p>
      </div>
      <div className={styles.card}>
        <AuthModeTabs
          mode={requestedMode}
          busy={busy}
          onSelect={setRequestedMode}
        />
        <motion.form
          id={`${fieldPrefix}-form`}
          name={`${fieldPrefix}-form`}
          ref={formRef}
          className={styles.form}
          data-auth-mode={mode}
          noValidate={true}
          initial={false}
          animate={phase}
          variants={contentVariants}
          onFocusCapture={(event: FocusEvent<HTMLFormElement>) => {
            setActiveHelpField(focusedHelpField(event.target, activeHelpField))
          }}
          onAnimationComplete={(definition: unknown) => {
            if (definition === 'hidden') switchMode(requestedMode)
          }}
          onSubmit={handleSubmit}
        >
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {status && (
            <p role="status" className={styles.status}>
              {status}
            </p>
          )}
          <div className={styles.field}>
            <label htmlFor={`${fieldPrefix}-email`}>Western email</label>
            <input
              className={styles.input}
              id={`${fieldPrefix}-email`}
              name={mode === 'recovery' ? 'email' : `${fieldPrefix}-email`}
              type="email"
              required={true}
              autoComplete={
                {
                  signin: 'username',
                  signup: 'section-signup email',
                  recovery: 'email',
                }[mode]
              }
              placeholder="you@uwo.ca"
              value={email}
              disabled={formDisabled}
              aria-describedby={`${id}-access`}
              onChange={(event) => {
                setEmail(event.target.value)
                setCode('')
              }}
            />
            <p id={`${id}-access`} className={styles.helper}>
              Access is limited to verified Western email addresses.
            </p>
            {mode === 'signup' && attempted && !isWesternEmail(email) && (
              <p className={styles.error}>Use a valid Western email.</p>
            )}
          </div>
          <UsernameField
            visible={mode === 'signup'}
            id={id}
            value={username}
            disabled={formDisabled || sent}
            active={
              activeHelpField === 'username' || (attempted && !signupReady)
            }
            availability={availability}
            onChange={setUsername}
          />
          {mode === 'signup' && attempted && !username && (
            <p className={styles.error}>Choose a username.</p>
          )}
          <div className={styles.field} data-help-field="password">
            <label htmlFor={`${fieldPrefix}-password`}>
              {mode === 'recovery' ? 'New password' : 'Password'}
            </label>
            <div className={styles.password}>
              <input
                className={styles.input}
                id={`${fieldPrefix}-password`}
                name={
                  mode === 'recovery' ? 'password' : `${fieldPrefix}-password`
                }
                type={showPassword ? 'text' : 'password'}
                required={true}
                minLength={modeCopy[mode].minLength}
                autoComplete={
                  mode === 'signin' ? 'current-password' : 'new-password'
                }
                value={password}
                disabled={formDisabled}
                aria-describedby={passwordDescription}
                aria-invalid={showPasswordError}
                onChange={(event) => {
                  const value = event.target.value
                  setPassword(value)
                  if (mode === 'signup' && value !== password) {
                    setSendError((current) =>
                      signupPasswordErrors.has(current) ? '' : current
                    )
                    setError((current) =>
                      signupPasswordErrors.has(current) ? '' : current
                    )
                  }
                }}
              />
              <button
                className={styles.reveal}
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                aria-controls={`${fieldPrefix}-password`}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                {showPassword ? (
                  <EyeOffIcon aria-hidden={true} />
                ) : (
                  <EyeIcon aria-hidden={true} />
                )}
              </button>
            </div>
            {mode !== 'signin' && (
              <>
                <FieldHelp
                  id={`${id}-password-help`}
                  active={
                    activeHelpField === 'password' || Boolean(showPasswordError)
                  }
                >
                  <div aria-hidden={true} className={styles.progress}>
                    {RULES.map((rule, index) => (
                      <span
                        key={rule.label}
                        className={index < passed ? styles.passed : undefined}
                      />
                    ))}
                  </div>
                  <ul
                    id={`${id}-rules`}
                    className={styles.rules}
                    aria-live="polite"
                  >
                    {RULES.map((rule) => {
                      const met = rule.test(password)
                      return (
                        <li
                          key={rule.label}
                          className={met ? styles.met : undefined}
                        >
                          {met ? (
                            <CheckIcon aria-hidden={true} />
                          ) : (
                            <CircleIcon aria-hidden={true} />
                          )}
                          {rule.label}
                          <span className={styles.srOnly}>
                            {met ? ' (satisfied)' : ' (required; not yet met)'}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </FieldHelp>
                {showPasswordError && (
                  <p
                    id={`${id}-password-error`}
                    role="alert"
                    className={styles.error}
                  >
                    Password must meet all requirements.
                  </p>
                )}
              </>
            )}
          </div>
          {mode !== 'signin' && (
            <div className={styles.field}>
              <label htmlFor={`${id}-code`}>Verification code</label>
              <div className={styles.codeRow}>
                <input
                  className={styles.input}
                  id={`${id}-code`}
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  value={code}
                  disabled={formDisabled}
                  onChange={(event) => setCode(event.target.value)}
                />
                <StatefulButton
                  className={styles.send}
                  type="button"
                  disabled={sendCodeDisabled(switching, busy, cooldown)}
                  successText="Sent"
                  errorText="Retry"
                  minLoadingMs={200}
                  onClick={sendCode}
                >
                  {sendLabel}
                </StatefulButton>
              </div>
              {sendError && (
                <p role="alert" className={styles.error}>
                  {sendError}
                </p>
              )}
              {mode === 'signup' &&
                attempted &&
                (!sent || !/^\d{6,10}$/.test(code.trim())) && (
                  <p className={styles.error}>
                    Send a verification code and enter it.
                  </p>
                )}
            </div>
          )}
          {mode === 'signup' && (
            <div className={styles.agreement}>
              <input
                id={`${id}-terms`}
                type="checkbox"
                required={true}
                checked={agreement}
                disabled={formDisabled}
                onChange={(event) => setAgreement(event.target.checked)}
              />
              <div>
                <label htmlFor={`${id}-terms`}>
                  I agree to the Marketplace rules
                </label>
                <button
                  className={styles.information}
                  type="button"
                  aria-label="Read Community Standards"
                  onClick={() => setShowStandards(true)}
                >
                  !
                </button>
              </div>
            </div>
          )}
          {mode === 'signup' && attempted && !agreement && (
            <p className={styles.error}>Agree to the Marketplace rules.</p>
          )}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- The focusable requirements group exposes feedback when its native Hold button is disabled. */}
          <div
            role={mode === 'signup' && !signupReady ? 'group' : undefined}
            tabIndex={mode === 'signup' && !signupReady ? 0 : undefined}
            aria-label={
              mode === 'signup' && !signupReady
                ? 'Create account requirements'
                : undefined
            }
            onKeyDown={(event) => {
              if (
                mode === 'signup' &&
                !signupReady &&
                (event.key === 'Enter' || event.key === ' ')
              ) {
                event.preventDefault()
                setAttempted(true)
                setPasswordError(!validSignupPassword(password))
              }
            }}
            onPointerDownCapture={() => {
              if (mode === 'signup' && !signupReady) {
                setAttempted(true)
                setPasswordError(!validSignupPassword(password))
              }
            }}
          >
            <AuthSubmit
              mode={mode}
              disabled={formDisabled || (mode === 'signup' && !signupReady)}
              busy={busy}
              label={submit}
              form={formRef}
            />
          </div>
          {mode === 'signup' && !signupReady && (
            <p role="status" className={styles.helper}>
              Complete all required fields to create your account.
              <span className={styles.srOnly}> {missing.join(' ')}</span>
            </p>
          )}
          {mode === 'signin' && (
            <button
              type="button"
              className={styles.secondary}
              disabled={formDisabled}
              onClick={() => setRequestedMode('recovery')}
            >
              Forgot password?
            </button>
          )}
        </motion.form>
      </div>
      <p className={styles.privacy}>
        Western email required.
        <br />
        Your Western email is used to verify access and secure your account. It
        is not displayed publicly.
      </p>
      {showStandards && (
        <CommunityStandards onClose={() => setShowStandards(false)} />
      )}
    </section>
  )
}
