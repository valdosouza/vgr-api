import { z } from 'zod'

/**
 * Password policy for NEW passwords (decision 114): minimum 12, maximum 72
 * (bcrypt's effective input limit), NO composition rules (NIST 800-63B —
 * composition breeds "Senha@123"; length breeds entropy), plus rejection
 * of known-weak choices.
 *
 * Note on the banned list: the classic top-1000 leaked passwords are
 * almost all SHORTER than 12 characters, so the length floor already
 * rejects them. What survives the floor is the padded/repeated/sequential
 * family — so the defense here is patterns + the common ≥12 stragglers,
 * not a thousand-line list that length already neutralized.
 *
 * Applies to: user creation/update (user.dto) and password change via
 * recovery (password-recovery.dto). NEVER to login — login checks what
 * the password IS, not what it should have been.
 */

const COMMON_LONG_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  'password1234',
  'password12345',
  'senha12345678',
  'administrator',
  'qwertyuiop12',
  'qwertyuiopas',
  'iloveyou1234',
  'welcome12345',
  'q1w2e3r4t5y6',
  '1q2w3e4r5t6y',
  'abc123abc123',
  'passwordpassword',
  'adminadmin123',
])

/** All same char (aaaaaaaaaaaa) or one straight run (123456789012, abcdefghijkl). */
function isTrivialSequence(value: string): boolean {
  const lower = value.toLowerCase()
  if (/^(.)\1+$/.test(lower)) return true
  let ascending = true
  let descending = true
  for (let index = 1; index < lower.length; index++) {
    const step = lower.charCodeAt(index) - lower.charCodeAt(index - 1)
    if (step !== 1) ascending = false
    if (step !== -1) descending = false
  }
  return ascending || descending
}

/** Short block repeated to fill the length (abcabcabcabc, 121212121212). */
function isRepeatedBlock(value: string): boolean {
  const lower = value.toLowerCase()
  for (let size = 1; size <= 4; size++) {
    if (lower.length % size === 0 && size < lower.length) {
      const block = lower.slice(0, size)
      if (block.repeat(lower.length / size) === lower) return true
    }
  }
  return false
}

export function isAcceptablePassword(value: string): boolean {
  const lower = value.toLowerCase()
  if (COMMON_LONG_PASSWORDS.has(lower)) return false
  if (isTrivialSequence(lower)) return false
  if (isRepeatedBlock(lower)) return false
  return true
}

/** Zod schema for any NEW password field (decision 114). */
export const newPasswordSchema = z
  .string()
  .min(12)
  .max(72)
  .refine(isAcceptablePassword, { message: 'Password is too common or predictable' })
