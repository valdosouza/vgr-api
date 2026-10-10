import bcrypt from 'bcryptjs'
import { grantAllPrivileges, upsertAdminAccount } from '@modules/auth/admin-account.repository'
import logger from '@shared/logger/logger'

/** Bootstrap of the very first team account (decisions 70/75): creates or
 *  updates the tb_user row and grants it every cataloged privilege. Everyday
 *  account creation happens on the Users screen, not here.
 *  Usage: npm run seed:admin -- <email> <password> (dev) or npm run seed:admin:prod -- <email> <password> (built) */
async function main() {
  const [email, password] = process.argv.slice(2)
  if (!email || !password) {
    logger.error('Usage: seed-admin.ts <email> <password>')
    process.exit(1)
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const userId = await upsertAdminAccount(email, passwordHash)
  await grantAllPrivileges(userId)
  logger.info(`Team user seeded/updated for ${email} with full privileges (id ${userId})`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Failed to seed admin account', { err })
    process.exit(1)
  })
