import { Response, Request } from 'express'
import { z } from 'zod'
import { HttpError, FieldError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'
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
      ...(err.code ? { code: err.code } : {}),
      ...(err.fields ? { fields: err.fields } : {}),
    })
    return
  }

  logger.error(`Error in ${ctx}`, { err })
  res.status(500).json({ error: 'Internal error', code: ErrorCodes.INTERNAL })
}

/** Validates the route's :id; responds 400 and returns null if invalid. */
export function parseId(req: Request, res: Response): number | null {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 0) {
    res.status(400).json({ error: 'Invalid id', code: ErrorCodes.INVALID_ID })
    return null
  }
  return id
}

/** Converts Zod issues into the per-field format. */
export function zodToFields(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    message: issue.message,
  }))
}

/**
 * Validates the body against the Zod schema; responds 400
 * `{ error, fields[] }` and returns null if invalid. Usage:
 * `const body = parseBody(dto, req, res); if (body === null) return`.
 */
export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  req: Request,
  res: Response
): z.infer<S> | null {
  const parsed = schema.safeParse(req.body)
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
