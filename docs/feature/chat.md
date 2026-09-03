# Masked chat — C1 (API)

Decisions 54, 168-177 (`AI/docs/decisions/VGR-plano.md`, round 12); plan
in `AI/docs/plans/plano-chat.md`; spec task 29 / `ChatThread` +
`MaskedIdentity` in `docs/specs/vgr/003-api-tactical-design.md` (amended
2026-09-03). A NEW bounded context — `src/modules/messaging/` — on the app
plane. C2 (mobile) and C3 (panel reading under `chat_evidence`, decision
175) are separate phases; C3 is NOT built here, but the repository already
lists threads and messages by report id for it.

Invariants (each has a test):

- **Only a routable identity talks (169)**: the report OWNER (account, or
  the anonymous reporter presenting the report's `clientKey` in the
  `x-client-key` header — the bearer-secret pattern of 134/137) and ONE
  helper who holds an account AND a `tb_help_offer` on that report. A
  helper who offered WITHOUT an account (`helper_account_id IS NULL`)
  can never open or read a thread; the app warns them before offering.
  The owner never talks to themself (20).
- **The mask is never more permissive than the offer (170)**: payloads
  carry `participantToken` (opaque, per (thread, participant), never the
  same across threads or reports), `role`, and `displayName` ONLY for the
  helper when `offer.anonymous = false` AND the tier is not `high`; the
  reporter's `displayName` is ALWAYS null. No `accountId`, no report
  `clientKey`, no e-mail anywhere. A thread is strictly bilateral: other
  helpers of the same report get 404 (55 — existence is information).
- **No direct contact crosses the channel (171)** — enforced by the server
  (`shared/chat/contact-filter.ts`), mirrored by the app for feedback.
- **The chat follows the case (173)** and the platform always knows who is
  who (23/60): `tb_chat_participant` keeps the internal link, the API
  serves the token.

## Plane and routes (`/app-chat`, `chat.routes.ts`)

Mounted in `app.ts` behind `rateLimitMiddleware`, every route behind
`optionalAppAuth` (bare request = anonymous; a PRESENT-but-invalid token is
401). Viewer = `{ accountId, clientKey }` exactly like reports:
`x-client-key` HEADER, never the URL. Never under `/api`. Append-only
(177): there is no PUT nor DELETE. Text only.

| Route | Who | Answers |
|---|---|---|
| `GET /app-chat/:reportId/threads` | owner (account or key) → every thread of the case; helper with an identified offer → their own thread or `[]`; anyone else 404 | `200 { threads: ThreadSummary[] }` |
| `POST /app-chat/:reportId/messages` | HELPER with account + offer: the thread is **find-or-create on the first message** (173), gate first | `201 { threadId, message }`; replay `200 { threadId, message, replayed: true }`; owner → **403** `FORBIDDEN` (they use the thread route); no account / no offer → 404; closed → 409 |
| `GET /app-chat/threads/:threadId/messages?after=<messageId>&limit=<1..200, default 50>` | participants only (404 otherwise) | `200 { threadId, closed, tier, messages: Message[] }` ascending by id from the cursor; advances the caller's `last_read_message_id` to the max served |
| `POST /app-chat/threads/:threadId/messages` | participants only | same 201 / 200 / 409 / 422 / 429 / 451 rules |

```
ThreadSummary { threadId, reportId, me: Participant, other: Participant,
                lastMessageAt: ISO|null (degraded), unreadCount, closed: boolean }
Participant   { participantToken: 32 hex, role: 'reporter'|'helper', displayName: string|null }
Message       { messageId, clientKey, sender: participantToken, mine: boolean,
                text: string|null, purged: boolean, createdAt: ISO (degraded) }
```

Body of both POSTs: `{ clientKey: UUID (the MESSAGE's idempotency key),
text }`. `messageId` is a BIGINT served as a number; the client keeps the
highest one as its cursor.

## Service order (`chat.service.ts`)

Both POST routes converge on one `post()` whose ordering encodes the
principles, as `submitReport` does:

1. **Idempotency first (172/137)**: a message already stored under the
   `clientKey` is answered as-is with `replayed: true` — even on a closed
   case, even before the gate: an offline-queue replay is never punished.
   Two replays racing on the UNIQUE `(thread, client_key)` resolve to the
   winner (`insertMessage` returns null on `ER_DUP_ENTRY`, the service
   re-reads).
2. **Closed case (173)** → `409 CHAT_CLOSED`: `status = 'resolved'`
   (18/131) or `hidden = 'S'` (162). Reads stay until the purge. A
   FROZEN case (141) keeps reading AND writing. Nothing is stamped on the
   chat: `closed` is derived from the report at read/write time.
3. **Text rules (171/177)** → 422: trim, min 1 (`REQUIRED`), max
   `CHAT_MAX_LENGTH` (`TOO_LONG`, `params.max`), then the contact filter:
   `{ error, code: 'CONTACT_NOT_ALLOWED', fields: [{ field: 'text', code:
   'CONTACT_NOT_ALLOWED', params: { kind, match } }] }`.
4. **Legal Gate before any write (176)**: `assertCapability('chat.masked')`
   with `userRef` = the account (undefined for the anonymous reporter) —
   before the thread is created and before every post; blocked → `451
   LEGAL_BLOCKED`. Reads are not gated. Wired in this delivery, so it
   never entered `PENDING_WIRING` (the catalog partition spec proves it).
5. **Rate window (177)** → `429 RATE_LIMITED` (`params: { limit,
   windowSeconds }`): `CHAT_RATE_PER_MINUTE` messages per thread per
   participant in a sliding 60 s window, **counted in the database**
   (`created_at > NOW() - INTERVAL 60 SECOND` on the `(sender,
   created_at)` key) — no in-memory state, so every instance enforces the
   same number.
6. Append + **accountability for the anonymous reporter (23)**:
   `appendAccountabilityLogEntry('chat.message', ip, { threadId,
   messageId })`, logged on failure, never blocking (123). Helpers and
   identified owners leave no trail.

Thread creation (`postToReport`): owner → 403; no account → 404; no
identified offer → 404; existing thread → post; otherwise closed-check,
text rules, gate, then `insertThreadWithParticipants` (thread + both
masks in ONE transaction) — a race on the UNIQUE `(report, helper)` key
returns null and the loser adopts the winner's thread.

Membership on a thread is derived from the REPORT row (ownership exactly
as `reports.service.owns`) and the thread's `helper_account_id` — the
participant columns are the record for C3, not the authority.

## Timestamps and read pointer (174)

`createdAt` and `lastMessageAt` are `degradeTimestamp(value, tier)`
(`shared/geo/degrade` — minute / 15 min / hour), ordering is by id. There
is no read receipt: `last_read_message_id` is the reader's OWN pointer
(unread count = the other side's messages with `id >` it), advanced by the
GET, only ever forward, and never served to the other side.

## Anti-contact filter (`shared/chat/contact-filter.ts`, 171)

`findContact(text): { kind, match } | null`. Case-insensitive, accents
stripped (NFD) before matching; the excerpt returned is the sender's own
text. Detection order: e-mail → URL → phone → messenger → handle.

| kind | rule |
|---|---|
| `phone` | a run of digits with spaces / dots / dashes / parentheses / leading `+` holding **>= 8 digits**. 7 digits pass — house numbers, times (`15h30`, `15:30`), money (`R$ 1.500,00`), dates, short case ids are all under the bar or broken by a non-separator character |
| `email` | `local@domain.tld` |
| `url` | `http(s)://…`, `www.…`, or a bare `domain.tld` with a >= 2-letter TLD (a period followed by a space is a sentence, not a domain) |
| `messenger` | `whatsapp | whats | instagram | insta | facebook | face | telegram | signal | discord | tiktok | zap` (word-bounded) followed within 40 characters by a digit or an `@handle` |
| `handle` | `@` + >= 3 chars, not glued to an e-mail |

Known false positives accepted with the rule as decided: a bare
`word.word` typo without a space reads as a domain; `face` is a listed
word, so "em face de 3 pessoas" is refused. The app's mirror gives the
sender the excerpt to rewrite.

## Storage (migration `043_chat.sql`)

- `tb_chat_thread` (report FK, `helper_account_id` NOT NULL FK, offer FK,
  `deleted`; UNIQUE `(tb_report_id, helper_account_id)`).
- `tb_chat_participant` (thread FK, `role` CHECK reporter|helper,
  `account_id` NULL, `client_key` NULL — the reporter's, `token` CHAR(32)
  UNIQUE from `crypto.randomBytes(16)`, `last_read_message_id`; UNIQUE
  `(thread, role)`).
- `tb_chat_message` (BIGINT id, thread FK, sender participant FK,
  `client_key` CHAR(36), `text` TEXT NULL, `purged` CHAR(1); UNIQUE
  `(thread, client_key)`; KEY `(thread, id)`; KEY `(sender, created_at)`).
- `tb_legal_capability` row `chat.masked` (module `messaging`), pattern of
  033.

Env (`.env.example`): `CHAT_MAX_LENGTH=1000`, `CHAT_RATE_PER_MINUTE=30`
(`shared/config/env.ts` `chatConfig()`).

## Propagation into reports

- `reports.repository.purgeReport` is now ONE transaction: report payload,
  timeline payloads and the case's chat text (`tb_chat_message.text =
  NULL, purged = 'S'` through `tb_chat_thread`) — rows, counts and
  timestamps stay (131 skeleton). Resolve stamps nothing on the chat: the
  messages follow `expires_at` through the report id.
- `GET /app-reports/:id` owner/participant views gain `chat`: the owner
  `{ threads, unread }`, a helper participant `{ threadId: number|null,
  unread }` (null before their first message). Public and summary views
  carry NO chat field.

## Tests

`shared/chat/__tests__/contact-filter.spec` (every kind, the 8-digit
boundary both sides, false-positive guards), `chat.service.spec`
(eligibility matrix, mask matrix, token uniqueness across two threads,
gate before any write, replay and both races, closed on resolved/hidden,
frozen keeps writing, 429 at the 31st, degraded timestamps, read pointer
and unread, accountability only for the anonymous reporter, serialized
payloads free of `accountId` / report `clientKey` / e-mail),
`chat.routes.spec` (header vs URL, plane, 400/401/403/404/409/422/429/451
shapes, no PUT/DELETE, defaults and cursor), `chat.repository.spec`
(transactional thread creation and the `ER_DUP_ENTRY` → null contract on
thread and message, cursor page, DB-clock rate window, unread and
forward-only pointer), `capabilities.catalog.spec` (chat.masked WIRED),
`reports.repository.spec` (purge transaction reaches the chat; the two
summary queries), `reports.lifecycle.spec` (the `chat` field per access
level).

## Status

- C1 — API side DONE 2026-09-03 (uncommitted). 88 suites / 832 tests
  green; `tsc` clean. C2 (mobile) and C3 (panel) await "pode seguir".
