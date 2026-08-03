import nodemailer from 'nodemailer'
import logger from '@shared/logger/logger'

/**
 * SMTP mailer (password recovery — phase 2 of the admin-controls plan).
 * Configured via .env: SMTP_HOST/PORT/USER/PASSWORD/FROM.
 * Without SMTP_HOST the mailer runs in dev mode: content goes to the LOG.
 * Ported from setes-api's shared/mailer.
 */

export function isMailerConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST)
}

function transporter() {
  const port = Number(process.env.SMTP_PORT ?? 587)

  // 465 = implicit SSL (secure true); 587/25 = STARTTLS (secure false).
  // The port decides — a contradicting SMTP_SECURE causes the classic
  // "wrong version number" TLS error.
  const secure = port === 465

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  })
}

export interface MailMessage {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendMail(message: MailMessage): Promise<void> {
  if (!isMailerConfigured()) {
    logger.warn('SMTP not configured — email NOT sent (dev mode, content in log)', {
      to: message.to,
      subject: message.subject,
    })
    return
  }
  await transporter().sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  })
  logger.info('Email sent', { to: message.to, subject: message.subject })
}
