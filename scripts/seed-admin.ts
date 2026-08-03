import bcrypt from 'bcryptjs'
import { upsertAdminAccount } from '../src/modules/auth/admin-account.repository'
import logger from '../src/shared/logger/logger'

/** Usage: tsx --require tsconfig-paths/register scripts/seed-admin.ts <email> <password> */
async function main() {
  const [email, password] = process.argv.slice(2)
  if (!email || !password) {
    logger.error('Usage: seed-admin.ts <email> <password>')
    process.exit(1)
  }

  const passwordHash = await bcrypt.hash(password, 10)
  await upsertAdminAccount(email, passwordHash)
  logger.info(`AdminAccount seeded/updated for ${email}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Failed to seed admin account', { err })
    process.exit(1)
  })
