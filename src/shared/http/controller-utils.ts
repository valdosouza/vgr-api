import { Response, Request } from 'express'
import { z } from 'zod'
import { HttpError, FieldError } from '@shared/errors/http-error'
import { ErrorCodes, FieldErrorCodes } from '@shared/errors/error-codes'
import logger from '@shared/logger/logger'

/**
 * Utilities shared by the module controllers (symmetric module-to-module
 * pattern, mirroring setes-api — see
 * D:\ProjetoVGR\api\docs\adr\ARCHITECTURE.md).
 *
 * Error contract: `{ error, code?, fields?: [{ field, message }] }` — the
 * HTTP status discriminates the nature of the error (400/409 user-fixable;
 * 401 session; 500 technical).
 */

export function handleError(res: Response, err: unknown, ctx: string): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      ...(err.fields ? { fields: err.fields } : {}),
      ...(err.params ? { params: err.params } : {}),
    })
    return
  }

  logger.error(`Error in ${ctx}`, { err })
  res.status(500).json({ error: 'Internal error', code: ErrorCodes.INTERNAL })
}

/** Validates the route's :id; responds 400 and returns null if invalid. */
export function parseId(req: Request, res: Response): number | null {
  return parseIdParam(req, res, 'id')
}

/** parseId for a NAMED route parameter (:reportId / :threadId / :offerId,
 *  merged from the mount path) — same rule, same 400 envelope. */
export function parseIdParam(req: Request, res: Response, name: string): number | null {
  const id = Number(req.params[name])
  if (!Number.isInteger(id) || id < 0) {
    res.status(400).json({ error: 'Invalid id', code: ErrorCodes.INVALID_ID })
    return null
  }
  return id
}

/** Stable per-field code + params derived from the Zod issue (decision 83)
 *  — the client's translation key for form errors. */
function fieldCodeOf(issue: z.ZodIssue): { code: string; params?: Record<string, string> } {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined'
        ? { code: FieldErrorCodes.REQUIRED }
        : { code: FieldErrorCodes.INVALID_VALUE }
    case 'too_small':
      return { code: FieldErrorCodes.TOO_SHORT, params: { min: String(issue.minimum) } }
    case 'too_big':
      return { code: FieldErrorCodes.TOO_LONG, params: { max: String(issue.maximum) } }
    case 'invalid_string':
      return issue.validation === 'email'
        ? { code: FieldErrorCodes.INVALID_EMAIL }
        : { code: FieldErrorCodes.INVALID_FORMAT }
    case 'invalid_enum_value':
      return { code: FieldErrorCodes.INVALID_OPTION }
    case 'custom': {
      // A refinement may declare its own field code via `params.code`
      // (e.g. brTaxIdSchema, decision 155); otherwise it is a generic value error.
      const declared = issue.params?.code
      return { code: typeof declared === 'string' ? declared : FieldErrorCodes.INVALID_VALUE }
    }
    default:
      return { code: FieldErrorCodes.INVALID_VALUE }
  }
}

/** Converts Zod issues into the per-field format (message = English
 *  fallback; code/params = translation contract, decision 83). */
export function zodToFields(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    message: issue.message,
    ...fieldCodeOf(issue),
  }))
}

/** The one place the 422 VALIDATION_FAILED envelope is emitted — parseBody
 *  and parseQuery differ only in WHICH part of the request they validate. */
function parseWith<S extends z.ZodTypeAny>(schema: S, value: unknown, res: Response): z.infer<S> | null {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    // 422, not 400 (amended per docs/specs/vgr/004-api-test-scenarios.md,
    // which consistently expects 422 for semantic validation failures —
    // this file predates that spec and originally used 400).
    res.status(422).json({
      error: 'Validation failed',
      code: ErrorCodes.VALIDATION_FAILED,
      fields: zodToFields(parsed.error),
    })
    return null
  }
  return parsed.data
}

/**
 * Validates the body against the Zod schema; responds 422
 * `{ error, code, fields[] }` and returns null if invalid. Usage:
 * `const body = parseBody(dto, req, res); if (body === null) return`.
 */
export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  req: Request,
  res: Response
): z.infer<S> | null {
  return parseWith(schema, req.body, res)
}

/**
 * parseBody's twin for the query string: validates `req.query` against the
 * Zod schema with the SAME 422 envelope, so a list/feed filter error
 * translates by the same field codes as a form error. Usage:
 * `const query = parseQuery(dto, req, res); if (query === null) return`.
 */
export function parseQuery<S extends z.ZodTypeAny>(
  schema: S,
  req: Request,
  res: Response
): z.infer<S> | null {
  return parseWith(schema, req.query, res)
}
