import { z } from 'zod'

/**
 * TriggerPanicAlert body (decisions 65/191/196): `clientKey` is the
 * alert's own idempotency key AND ownership secret in one (pattern of
 * 137). NO message text (196 — the alert's message is a fixed template,
 * never free text from the triggering user). `position` is the ONE piece
 * of information the client must supply beyond the key — the API cannot
 * know the triggering device's location on its own (mirrors
 * submitReportDto's position object, reports.dto.ts).
 */
export const triggerPanicAlertDto = z.object({
  clientKey: z.string().uuid(),
  position: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
})

export type TriggerPanicAlertBody = z.infer<typeof triggerPanicAlertDto>

/**
 * Responder inbox query (decision 192, mirrors chatMessagesQueryDto's
 * cursor shape): `after`/`limit` page the snapshot; `lat`/`lng` are the
 * responder's OWN current position, required — mirrors feedQueryDto
 * (help-matching.dto.ts), which needs the same for its own distance calc.
 */
export const panicAlertsQueryDto = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
})

export type PanicAlertsQuery = z.infer<typeof panicAlertsQueryDto>
