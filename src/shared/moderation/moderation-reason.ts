import { z } from 'zod'
import { FieldErrorCodes } from '@shared/errors/error-codes'

/**
 * Moderation reason catalog (decision 163): fixed in CODE, canonical
 * English codes (17) — the code is what the statistics count (164) and
 * what the client translates (80). An administrable catalog is a later
 * evolution (same trajectory as risk-config, 140d).
 *
 * Lives in shared/ because two modules consume it from day one: reports
 * (hide/unhide, 162) and media (block/unblock, 162) — the no-cross-module-
 * import rule of ARCHITECTURE.md.
 */
export const MODERATION_REASONS = [
  'spam',
  'abuse',
  'illegal_content',
  'duplicate',
  'personal_data',
  'other',
] as const

export type ModerationReason = (typeof MODERATION_REASONS)[number]

export const MODERATION_NOTE_MIN = 3
export const MODERATION_NOTE_MAX = 500

/**
 * Body of every moderation act — hide/unhide/block/unblock alike (162:
 * reverting carries the same mandatory reason). `note` is free text,
 * optional for a catalog code and REQUIRED (>= 3 chars) when the code is
 * `other` (163). Field codes travel via `params.code` so zodToFields
 * (decision 83) translates them like any other form error.
 */
export const moderationReasonDto = z
  .object({
    reasonCode: z.enum(MODERATION_REASONS),
    note: z
      .string()
      .trim()
      .max(MODERATION_NOTE_MAX)
      .optional()
      // A blank note is no note: never persist "" as a reason.
      .transform((value) => (value ? value : undefined)),
  })
  .superRefine((body, ctx) => {
    if (body.reasonCode !== 'other') return
    if (body.note === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'A note is required when the reason is "other"',
        params: { code: FieldErrorCodes.REQUIRED },
      })
      return
    }
    if (body.note.length < MODERATION_NOTE_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: `The note must have at least ${MODERATION_NOTE_MIN} characters`,
        params: { code: FieldErrorCodes.TOO_SHORT },
      })
    }
  })

export type ModerationReasonInput = z.infer<typeof moderationReasonDto>
