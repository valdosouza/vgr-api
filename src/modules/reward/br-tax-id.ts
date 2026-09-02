import { z } from 'zod'
import { FieldErrorCodes } from '@shared/errors/error-codes'

/**
 * Brazilian tax id (CPF 11 digits / CNPJ 14 digits) check-digit validation
 * — decision 155: validated on BOTH sides so an invalid document never
 * reaches the PSP. Digits only: unmasking is the client's job (the app's
 * `vgr_validators` mirrors these functions test by test, decision 154).
 *
 * Lives in the reward module on purpose (decision 153): no shared
 * validation module in the API until a second consumer appears.
 */

const CPF_LENGTH = 11
const CNPJ_LENGTH = 14

function allSameDigit(digits: string): boolean {
  return /^(\d)\1*$/.test(digits)
}

/** Mod-11 check digit over `digits` with descending weights starting at `startWeight`. */
function mod11(digits: string, weights: number[]): number {
  const sum = [...digits].reduce((acc, ch, i) => acc + Number(ch) * weights[i], 0)
  const rest = sum % 11
  return rest < 2 ? 0 : 11 - rest
}

export function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || allSameDigit(value)) return false
  const base = value.slice(0, 9)
  const d1 = mod11(base, [10, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = mod11(base + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
  return value === base + d1 + d2
}

export function isValidCnpj(value: string): boolean {
  if (!/^\d{14}$/.test(value) || allSameDigit(value)) return false
  const base = value.slice(0, 12)
  const d1 = mod11(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = mod11(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return value === base + d1 + d2
}

/** Dispatches by length: 11 → CPF, 14 → CNPJ, anything else is invalid. */
export function isValidBrTaxId(value: string): boolean {
  if (value.length === CPF_LENGTH) return isValidCpf(value)
  if (value.length === CNPJ_LENGTH) return isValidCnpj(value)
  return false
}

/** Zod schema for a CPF/CNPJ: digits only, check digits verified; both
 *  failures surface as the same per-field code (decision 83). */
export const brTaxIdSchema = z
  .string()
  .regex(/^(\d{11}|\d{14})$/, 'Must be 11 (CPF) or 14 (CNPJ) digits')
  .refine(isValidBrTaxId, {
    message: 'Invalid CPF/CNPJ check digits',
    params: { code: FieldErrorCodes.INVALID_FORMAT },
  })
