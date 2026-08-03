/**
 * Progressive delay against per-account brute force (decision 113).
 * No hard lockout — locking after N failures would let anyone who knows
 * an admin's e-mail deny them access on purpose, unacceptable while that
 * admin may be mid-emergency (decision 45). Delay punishes machines
 * without locking humans: 5 free attempts, then 1s, 2s, 4s… capped at 30s.
 */
export function computeLoginDelayMs(failedCount: number): number {
  if (failedCount < 5) return 0
  return Math.min(2 ** (failedCount - 5), 30) * 1000
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
