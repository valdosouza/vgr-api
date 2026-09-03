import { Request, Response } from 'express'
import * as service from '@modules/messaging/chat.service'
import { chatMessagesQueryDto, postChatMessageDto } from '@modules/messaging/chat.dto'
import { ChatActor } from '@modules/messaging/chat.interface'
import { handleError, parseBody, zodToFields } from '@shared/http/controller-utils'
import { ErrorCodes } from '@shared/errors/error-codes'

/** Viewer identity exactly as reports build it: the session account
 *  and/or the report's bearer clientKey — a HEADER, never a URL parameter
 *  (a URL leaks into logs and referrers). */
function actorOf(req: Request): ChatActor {
  const header = req.headers['x-client-key']
  return {
    accountId: req.appAccountId ?? null,
    clientKey: typeof header === 'string' && header.length > 0 ? header : null,
    ip: req.ip ?? '',
  }
}

/** parseId for a named route parameter (:reportId / :threadId). */
function parseIdParam(req: Request, res: Response, name: string): number | null {
  const id = Number(req.params[name])
  if (!Number.isInteger(id) || id < 0) {
    res.status(400).json({ error: 'Invalid id', code: ErrorCodes.INVALID_ID })
    return null
  }
  return id
}

export async function listThreads(req: Request, res: Response): Promise<void> {
  try {
    const reportId = parseIdParam(req, res, 'reportId')
    if (reportId === null) return
    res.json(await service.listThreads(reportId, actorOf(req)))
  } catch (err) {
    handleError(res, err, 'chat.listThreads')
  }
}

export async function postToReport(req: Request, res: Response): Promise<void> {
  try {
    const reportId = parseIdParam(req, res, 'reportId')
    if (reportId === null) return
    const body = parseBody(postChatMessageDto, req, res)
    if (body === null) return
    const result = await service.postToReport(reportId, body, actorOf(req))
    // Replay of the offline queue answers 200 with the SAME message
    // (decision 172, contract of 137).
    res.status(result.replayed ? 200 : 201).json(
      result.replayed ? result : { threadId: result.threadId, message: result.message }
    )
  } catch (err) {
    handleError(res, err, 'chat.postToReport')
  }
}

export async function getMessages(req: Request, res: Response): Promise<void> {
  try {
    const threadId = parseIdParam(req, res, 'threadId')
    if (threadId === null) return
    const parsed = chatMessagesQueryDto.safeParse(req.query)
    if (!parsed.success) {
      res.status(422).json({
        error: 'Validation failed',
        code: ErrorCodes.VALIDATION_FAILED,
        fields: zodToFields(parsed.error),
      })
      return
    }
    res.json(await service.getMessages(threadId, parsed.data, actorOf(req)))
  } catch (err) {
    handleError(res, err, 'chat.getMessages')
  }
}

export async function postToThread(req: Request, res: Response): Promise<void> {
  try {
    const threadId = parseIdParam(req, res, 'threadId')
    if (threadId === null) return
    const body = parseBody(postChatMessageDto, req, res)
    if (body === null) return
    const result = await service.postToThread(threadId, body, actorOf(req))
    res.status(result.replayed ? 200 : 201).json(
      result.replayed ? result : { threadId: result.threadId, message: result.message }
    )
  } catch (err) {
    handleError(res, err, 'chat.postToThread')
  }
}
