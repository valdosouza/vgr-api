import cron from 'node-cron'
import { startScheduler } from '@gateway/scheduler'

jest.mock('node-cron', () => ({
  __esModule: true,
  default: { schedule: jest.fn() },
}))

describe('scheduler guards (decision 90)', () => {
  it('never registers jobs under test — NODE_ENV=test is this very run', () => {
    startScheduler()
    expect(cron.schedule).not.toHaveBeenCalled()
  })
})
