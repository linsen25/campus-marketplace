import type { WesternBuilding } from '@/types/meeting-location'

/** Public-facing choices from Western's buildings directory; no addresses or coordinates. */
export const westernBuildings: readonly WesternBuilding[] = [
  { code: 'UCC', name: 'University Community Centre (UCC)' },
  { code: 'WL', name: 'D.B. Weldon Library (WL)' },
  { code: 'NSC', name: 'Natural Sciences Centre (NSC)' },
  { code: 'SSC', name: 'Social Science Centre (SSC)' },
  { code: 'UC', name: 'University College (UC)' },
  { code: 'MC', name: 'Middlesex College (MC)' },
  { code: 'PAB', name: 'Physics & Astronomy Building (PAB)' },
  { code: 'WSRC', name: 'Western Student Recreation Centre (WSRC)' },
  { code: 'WSSB', name: 'Western Student Services Building (WSSB)' },
  { code: 'WSC', name: 'Western Science Centre (WSC)' },
  { code: 'AH', name: 'Alumni Hall (AH)' },
  { code: 'SEB', name: 'Spencer Engineering Building (SEB)' },
  { code: 'IVEY', name: 'Richard Ivey Building (IVEY)' },
  { code: 'CC', name: 'Convergence Centre (CC)' },
] as const
