/**
 * Decision 110: no secret ever reaches a log. Originally enforced only in
 * admin-audit's own `sanitize()` (SEC-6) — every other of the ~30 logger.*
 * call sites across the codebase depended on whoever wrote that line
 * remembering not to pass a secret in. That's a rule nothing checks, and
 * the password-recovery/email-verification OTP leak (fixed separately via
 * the LOG_DEV_SECRETS opt-in) is exactly what "nothing checks it" produces.
 *
 * This redacts by key name at the one place every log line passes through
 * (`logger.ts`), so the guard applies to every call site automatically —
 * present and future — instead of requiring per-callsite discipline.
 */
const SENSITIVE_KEY_PATTERN = /password|secret|token|key|code/i

const SENSITIVE_KEY_NAMES = new Set([
  'ip',
  'ipaddress',
  'remoteaddr',
  'clientip',
  'body',
  'requestbody',
  'payload',
  'location',
  'lat',
  'lng',
  'latitude',
  'longitude',
  'coords',
  'coordinates',
  'geo',
])

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase()
  if (SENSITIVE_KEY_PATTERN.test(normalized)) return true
  return SENSITIVE_KEY_NAMES.has(normalized.replace(/[^a-z]/g, ''))
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object' && !(value instanceof Error)) {
    const clean: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      clean[key] = isSensitiveKey(key) ? '[redacted]' : redact(entry)
    }
    return clean
  }
  return value
}
