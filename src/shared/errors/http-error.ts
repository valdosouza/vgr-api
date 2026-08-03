/** Error for a specific field in the response payload (decision 83:
 *  `code` is the field's translation key, `params` its interpolated
 *  values, `message` the English fallback). */
export interface FieldError {
  field: string
  message: string
  code?: string
  params?: Record<string, string>
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    /** Fields that caused the error — go into the `{ error, fields }` payload. */
    public fields: FieldError[] | undefined,
    /** Code from the known-error catalog (error-codes.ts); REQUIRED since
     *  decision 80 made it the client's translation contract. */
    public code: string,
    /** Interpolated values referenced by the message (decision 83) — the
     *  client re-interpolates them into the translated text. */
    public params?: Record<string, string>
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
