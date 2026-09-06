import { Request, Response } from 'express'
import * as service from '@modules/messaging/chat.service'
import { chatMessagesQueryDto, postChatMessageDto } from '@modules/messaging/chat.dto'
import { appActorOf } from '@shared/http/app-actor'
import { handleError, parseBody, parseIdParam, parseQuery } from '@shared/http/controller-utils'

/** The viewer is the app actor of shared/http/app-actor (ChatActor is that
 *  shape): the session account and/or the report's bearer clientKey — a
 *  HEADER, never a URL parameter (a URL leaks into logs and referrers).
 *  Route ids (:reportId / :threadId) come through parseIdParam. */

export async function listThreads(req: Request, res: Response): Promise<void> {
  try {
    const reportId = parseIdParam(req, res, 'reportId')
    if (reportId === null) return
    res.json(await service.listThreads(reportId, appActorOf(req)))
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
    const result = await service.postToReport(reportId, body, appActorOf(req))
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
    const query = parseQuery(chatMessagesQueryDto, req, res)
    if (query === null) return
    res.json(await service.getMessages(threadId, query, appActorOf(req)))
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
    const result = await service.postToThread(threadId, body, appActorOf(req))
    res.status(result.replayed ? 200 : 201).json(
      result.replayed ? result : { threadId: result.threadId, message: result.message }
    )
  } catch (err) {
    handleError(res, err, 'chat.postToThread')
  }
}
