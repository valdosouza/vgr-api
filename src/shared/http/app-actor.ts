import { Request } from 'express'

/**
 * Who is calling on the APP plane (tb_user_account — decision 119): the
 * session account appAuthMiddleware set (null where the route allows an
 * anonymous caller), the bearer clientKey of decisions 134/137, and the
 * IP for the Legal Gate and the accountability trail (23).
 *
 * The clientKey is a HEADER, never a URL parameter — a URL leaks into
 * logs and referrers. An absent, empty or repeated header reads as "no
 * key": only a single non-empty value is a credential.
 *
 * Modules keep their own typed names for this shape (ChatActor,
 * RatingActor, PanicAlertActor, reports' ViewerContext) — every one of
 * them is built from here.
 */
export interface AppActor {
  accountId: number | null
  clientKey: string | null
  ip: string
}

export function appActorOf(req: Request): AppActor {
  const header = req.headers['x-client-key']
  return {
    accountId: req.appAccountId ?? null,
    clientKey: typeof header === 'string' && header.length > 0 ? header : null,
    ip: req.ip ?? '',
  }
}
