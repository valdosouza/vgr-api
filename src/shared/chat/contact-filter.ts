/**
 * Anti-contact filter for the masked chat (decision 171). The chat exists
 * to coordinate help on the platform; decision 54 says "sem compartilhar
 * contato direto" — not "with a warning" — so the SERVER refuses any
 * message that carries a way to continue off-platform. The rule lives in
 * shared/ because it is a product rule, not a module's; the app mirrors it
 * in vgr_validators (154) for feedback before sending, never as the
 * authority.
 *
 * What is detected (contract of decision 171):
 *  - phone numbers: >= 8 digits, tolerant to spaces / dots / dashes /
 *    parentheses / a leading '+'. Under 8 digits is an ordinary number —
 *    a house number, a time, a case id — and MUST pass;
 *  - e-mail addresses;
 *  - URLs: http(s)://, www., or a bare domain.tld (>= 2-letter TLD);
 *  - @handles of >= 3 characters;
 *  - a messenger name (whats, whatsapp, zap, telegram, insta, instagram,
 *    signal, discord, tiktok, facebook) followed within 40
 *    characters by a number or a handle.
 * Matching is case-insensitive with accents stripped first.
 */

export type ContactKind = 'phone' | 'email' | 'url' | 'handle' | 'messenger'

export interface ContactHit {
  kind: ContactKind
  /** The offending excerpt, as written by the sender (for the client to point at). */
  match: string
}

const PHONE_MIN_DIGITS = 8
const MESSENGER_WINDOW = 40

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/
const URL = /(https?:\/\/[^\s]+|www\.[^\s]+|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}\b)/
/** A run of digits and phone separators, starting and ending on a digit. */
const PHONE_CANDIDATE = /\+?\(?\d[\d\s().+-]*\d/g
const MESSENGER = new RegExp(
  `\\b(whatsapp|whats|instagram|insta|facebook|telegram|signal|discord|tiktok|zap)\\b` +
    `[\\s\\S]{0,${MESSENGER_WINDOW}}?(\\d|@[a-z0-9_])`
)
/** '@' not glued to an e-mail's local part, then >= 3 handle characters. */
const HANDLE = /(?<![a-z0-9._%+-])@[a-z0-9_.]{3,}/

/** Lowercase + accents stripped; length-preserving for Latin text, so
 *  indexes map back onto the original for the excerpt. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function digitCount(value: string): number {
  return (value.match(/\d/g) ?? []).length
}

function excerpt(original: string, index: number, length: number): string {
  return original.slice(index, index + length)
}

function findPhone(normalized: string): { index: number; length: number } | null {
  PHONE_CANDIDATE.lastIndex = 0
  let candidate: RegExpExecArray | null
  while ((candidate = PHONE_CANDIDATE.exec(normalized)) !== null) {
    if (digitCount(candidate[0]) >= PHONE_MIN_DIGITS) {
      return { index: candidate.index, length: candidate[0].length }
    }
  }
  return null
}

/** Returns the first contact found in the text, or null when it is clean. */
export function findContact(text: string): ContactHit | null {
  const normalized = normalize(text)

  const email = EMAIL.exec(normalized)
  if (email) return { kind: 'email', match: excerpt(text, email.index, email[0].length) }

  const url = URL.exec(normalized)
  if (url) return { kind: 'url', match: excerpt(text, url.index, url[0].length) }

  const phone = findPhone(normalized)
  if (phone) return { kind: 'phone', match: excerpt(text, phone.index, phone.length) }

  // Messenger BEFORE handle: "telegram @ana" is reported as the messenger
  // invitation it is, not as a bare handle.
  const messenger = MESSENGER.exec(normalized)
  if (messenger) {
    return { kind: 'messenger', match: excerpt(text, messenger.index, messenger[0].length) }
  }

  const handle = HANDLE.exec(normalized)
  if (handle) return { kind: 'handle', match: excerpt(text, handle.index, handle[0].length) }

  return null
}
