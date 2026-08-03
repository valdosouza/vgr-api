/**
 * The two authentication planes (decision 119).
 *
 * The panel (`tb_user`) and the app (`tb_user_account`) are separate
 * authentication systems: separate tables, separate token audiences, and
 * cross-rejection in the middlewares. A token minted for one plane is a
 * 401 in the other BY CONSTRUCTION — so a weakness in the app plane can
 * never reach the panel that grants privileges and decrypts
 * life-at-risk data (decisions 45, 110).
 */
export const Audiences = {
  /** Team users of the admin panel — 15min sessions, mandatory 2FA (114). */
  ADMIN: 'admin',
  /** Reporters and helpers — 30min access + rotating refresh (122). */
  APP: 'app',
} as const

export type Audience = (typeof Audiences)[keyof typeof Audiences]
