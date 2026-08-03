import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'
import { Role, AnonymityMode } from '@modules/identity/identity.interface'

const ROLES: Role[] = ['anonymous', 'reporter', 'helper', 'police', 'admin']
const ANONYMITY_MODES: AnonymityMode[] = ['anonymous', 'identified_no_reward', 'identified_with_reward']

/** Roles a user may self-transition into from `anonymous` — `police` and
 *  `admin` are never reached this way (decision 12; admin is provisioned
 *  out of band). */
const SELF_SERVE_ROLES: Role[] = ['reporter', 'helper']

export function createRole(value: string): Role {
  if (!ROLES.includes(value as Role)) {
    throw new HttpError(422, `Invalid role: ${value}`, undefined, ErrorCodes.VALIDATION_FAILED)
  }
  return value as Role
}

export function createAnonymityMode(value: string, hasCompletedRegistration: boolean): AnonymityMode {
  if (!ANONYMITY_MODES.includes(value as AnonymityMode)) {
    throw new HttpError(422, `Invalid anonymity mode: ${value}`, undefined, ErrorCodes.VALIDATION_FAILED)
  }
  if (value === 'identified_with_reward' && !hasCompletedRegistration) {
    throw new HttpError(
      422,
      'identified_with_reward requires a completed UserAccount registration',
      undefined,
      ErrorCodes.VALIDATION_FAILED
    )
  }
  return value as AnonymityMode
}

export function transitionRole(currentRole: Role, targetRole: Role): Role {
  if (targetRole === 'police') {
    throw new HttpError(403, 'Role transition to police is deferred (decision 12)', undefined, ErrorCodes.FORBIDDEN)
  }
  if (currentRole === 'anonymous' && !SELF_SERVE_ROLES.includes(targetRole)) {
    throw new HttpError(422, `Cannot transition from anonymous to ${targetRole}`, undefined, ErrorCodes.VALIDATION_FAILED)
  }
  return targetRole
}
