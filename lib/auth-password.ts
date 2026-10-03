// The supplied Velora rules are shared by the form and authoritative API checks.
export const passwordRules = [
  {
    label: '8+ characters',
    test: (value: string) => value.length >= 8,
  },
  {
    label: '1 uppercase letter',
    test: (value: string) => /[A-Z]/.test(value),
  },
  { label: '1 number', test: (value: string) => /\d/.test(value) },
  { label: '1 symbol', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
]

export function validSignupPassword(value: unknown): value is string {
  return (
    typeof value === 'string' && passwordRules.every((rule) => rule.test(value))
  )
}
