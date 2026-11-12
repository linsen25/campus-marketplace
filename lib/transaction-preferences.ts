export type ResalePaymentMode =
  | 'in_person'
  | 'interac_etransfer'
  | 'uu_pay'
  | 'external'

export const resalePaymentOptions: Array<{
  value: ResalePaymentMode
  label: string
  description: string
  advantages: string
  risks: string
}> = [
  {
    value: 'in_person',
    label: 'Direct exchange',
    description: 'Pay and exchange directly with the seller.',
    advantages: 'Simple campus exchange with no UU processing fee.',
    risks:
      'Payment and exchange happen independently; UU cannot verify or refund it.',
  },
  {
    value: 'interac_etransfer',
    label: 'Interac e-Transfer',
    description: 'Arrange a bank transfer independently.',
    advantages: 'Convenient for supported Canadian bank accounts.',
    risks:
      'UU does not verify arrival or provide payment protection; watch for scams.',
  },
  {
    value: 'uu_pay',
    label: 'UU Protected Payment',
    description: 'Pay through UU using Stripe, with eligible buyer protection.',
    advantages:
      "Stripe payment events and UU's existing 48-hour workflow apply.",
    risks:
      'Seller verification and processing fees may apply; eligibility rules and disputes apply.',
  },
]

export function resalePaymentOption(mode: ResalePaymentMode) {
  return resalePaymentOptions.find((option) => option.value === mode)!
}
