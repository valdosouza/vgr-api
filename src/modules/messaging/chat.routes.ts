import { Router } from 'express'
import { optionalAppAuth } from '@gateway/optional-app-auth.middleware'
import * as controller from '@modules/messaging/chat.controller'

/**
 * Masked chat (C1 — decisions 54, 169-177), mounted under /app-chat: app
 * plane, never /api. Every route runs optionalAppAuth: the reporter may
 * be anonymous (x-client-key header, 134/137), the helper must hold an
 * account (169). Append-only (177): no PUT, no DELETE. Panel reading
 * (C3, decision 175) is a separate front.
 */
const router = Router()

/**
 * @swagger
 * /app-chat/threads/{threadId}/messages:
 *   get:
 *     summary: Cursor page of a thread's masked messages (participants only); advances the caller's own read pointer (decisions 170/172/174)
 *     security: []
 *     tags: [Chat]
 *   post:
 *     summary: Appends a text message to an existing thread (participants only); idempotent by clientKey; refuses direct contact, closed cases and floods (decisions 171/172/173/176/177)
 *     security: []
 *     tags: [Chat]
 */
// Literal segment first so 'threads' never parses as a report id.
router.get('/threads/:threadId/messages', optionalAppAuth, controller.getMessages)
router.post('/threads/:threadId/messages', optionalAppAuth, controller.postToThread)

/**
 * @swagger
 * /app-chat/{reportId}/threads:
 *   get:
 *     summary: The owner's threads (one per helper) or the helper's own thread — masked participants, unread count (decisions 55/169/170)
 *     security: []
 *     tags: [Chat]
 * /app-chat/{reportId}/messages:
 *   post:
 *     summary: Helper with an account and an offer posts; the thread is find-or-create on the first message (decisions 169/173/176)
 *     security: []
 *     tags: [Chat]
 */
router.get('/:reportId/threads', optionalAppAuth, controller.listThreads)
router.post('/:reportId/messages', optionalAppAuth, controller.postToReport)

export default router
