import { Request, Response } from 'express'
import * as service from '@modules/messaging/chat-admin.service'
import { chatEvidenceQueryDto } from '@modules/messaging/chat.dto'
import { auditFromRequest } from '@shared/audit/admin-audit'
import { ErrorCodes } from '@shared/errors/error-codes'
import { handleError, parseId, zodToFields } from '@shared/http/controller-utils'

/**
 * Panel plane of the chat (C3 — decision 175). The read is audited HERE,
 * after the service succeeded (a 404/422 leaves no row): the actor and IP
 * live at the HTTP layer (implementation note on decision 116). One row
 * per request, action `read`, entity `report_chat`, entityId = reportId
 * — the same posture as the case detail (166) and the exact position
 * (159). `:id` arrives merged from the mount path in gateway/router.ts.
 */
export async function chatEvidence(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    const parsed = chatEvidenceQueryDto.safeParse(req.query)
    if (!parsed.success) {
      res.status(422).json({
        error: 'Validation failed',
        code: ErrorCodes.VALIDATION_FAILED,
        fields: zodToFields(parsed.error),
      })
      return
    }
    const result = await service.getReportChatEvidence(id, parsed.data)
    auditFromRequest(req, 'read', 'report_chat', id)
    // No caching: a cached chat would be an unaudited read (159 pattern).
    res.setHeader('Cache-Control', 'no-store')
    res.json(result)
  } catch (err) {
    handleError(res, err, 'chat-admin.chatEvidence')
  }
}
