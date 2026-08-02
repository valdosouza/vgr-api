/** Error for a specific field in the response payload. */
export interface FieldError {
  field: string
  message: string
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    /** Fields that caused the error — go into the `{ error, fields }` payload. */
    public fields?: FieldError[],
    /** Code from the known-error catalog (error-codes.ts); goes into the
     *  payload as `code`. */
    public code?: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
