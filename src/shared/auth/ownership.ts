/**
 * Ownership on the APP plane — the bearer-secret pattern of decision 134,
 * as reports.service first defined it (R3) and chat, rating and panic
 * restated it: the actor OWNS the row when they hold the owning account,
 * OR when they present the row's clientKey — the secret the anonymous
 * reporter's app generated and kept (137). An anonymous owner (null
 * account) never matches an anonymous actor: anonymity is not an identity,
 * only the key is.
 *
 * Each module adapts its row at the call site — the owning account column
 * is `reporterAccountId` on a report and `accountId` on a panic alert —
 * so the rule itself lives here exactly once.
 */

/** The row side: who owns it (null = anonymous) and its bearer secret. */
export interface AccountOrKeyOwner {
  accountId: number | null
  clientKey: string
}

/** The caller side: the app session (null = anonymous) and/or the
 *  x-client-key header (null = not presented). */
export interface AccountOrKeyActor {
  accountId: number | null
  clientKey: string | null
}

export function ownsByAccountOrKey(owner: AccountOrKeyOwner, actor: AccountOrKeyActor): boolean {
  if (actor.accountId !== null && owner.accountId === actor.accountId) return true
  return actor.clientKey !== null && owner.clientKey === actor.clientKey
}
