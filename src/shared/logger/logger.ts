/* eslint-disable no-console */
import { redact } from '@shared/logger/redact'

function timestamp(): string {
  return new Date().toISOString()
}

export const logger = {
  info(message: string, meta?: unknown): void {
    console.log(`[${timestamp()}] INFO  ${message}`, meta === undefined ? '' : redact(meta))
  },
  warn(message: string, meta?: unknown): void {
    console.warn(`[${timestamp()}] WARN  ${message}`, meta === undefined ? '' : redact(meta))
  },
  error(message: string, meta?: unknown): void {
    console.error(`[${timestamp()}] ERROR ${message}`, meta === undefined ? '' : redact(meta))
  },
}

export default logger
