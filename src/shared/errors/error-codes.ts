/**
 * Catalog of known error codes — since decision 80 the `code` is the
 * TRANSLATION CONTRACT: API messages stay English-only and the client
 * translates by code. Every `HttpError` must cite one (enforced by the
 * constructor since decision 83).
 */
export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_ID: 'INVALID_ID',
  NOT_FOUND: 'NOT_FOUND',
  /** The value already exists (email, key, second identical approval...). */
  DUPLICATE: 'DUPLICATE',
  /** Cannot delete/change: other records still reference it. */
  IN_USE: 'IN_USE',
  /** The action would lock the actor out of administration (decision 70). */
  SELF_LOCKOUT: 'SELF_LOCKOUT',
  /** Payload is well-formed but violates a business rule. */
  BUSINESS_RULE: 'BUSINESS_RULE',
  /** Feature cataloged but deferred (e.g. police role — decision 12). */
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  /** Legal Gate refusal (decisions 76, 104): the capability is blocked in
   *  this jurisdiction. Ships with HTTP 451. */
  LEGAL_BLOCKED: 'LEGAL_BLOCKED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL: 'INTERNAL',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

/**
 * Per-field codes emitted by zodToFields (decision 83) — the client
 * translates each form error by this code, with the English Zod message as
 * fallback. `params` carries interpolated values (e.g. { min: '5' }).
 */
export const FieldErrorCodes = {
  REQUIRED: 'REQUIRED',
  TOO_SHORT: 'TOO_SHORT',
  TOO_LONG: 'TOO_LONG',
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_OPTION: 'INVALID_OPTION',
  INVALID_VALUE: 'INVALID_VALUE',
} as const

export type FieldErrorCode = (typeof FieldErrorCodes)[keyof typeof FieldErrorCodes]
