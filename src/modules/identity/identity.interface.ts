/** A user's capacity within a Report (decision 4). Transition to `police`
 *  is rejected outright until the validation workflow exists (decision 12).
 *  `admin` never participates in Report/AnonymityMode flows — it only
 *  gates `apps/admin` routes via `requireAdmin`. */
export type Role = 'anonymous' | 'reporter' | 'helper' | 'police' | 'admin'

/** How a user's identity is exposed to other users on a Report (decision 6).
 *  `identified_with_reward` requires a completed UserAccount registration
 *  (decision 4). */
export type AnonymityMode = 'anonymous' | 'identified_no_reward' | 'identified_with_reward'

export interface UserIdentity {
  userId: number
  role: Role
  anonymityMode: AnonymityMode
}
