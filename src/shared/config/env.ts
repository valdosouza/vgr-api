/**
 * Environment access for security-critical values (finding A2 in
 * AI/docs/plans/plano-seguranca.md). `process.env.JWT_SECRET ?? ''` let a
 * missing variable silently accept tokens signed with the empty string —
 * this module makes absence loud instead.
 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET is not configured')
  }
  return secret
}

/**
 * CORS origin allowlist (decision 115). Comma-separated CORS_ORIGIN env;
 * '*' is honored only outside production — in production a wildcard or a
 * missing value refuses boot instead (assertRequiredEnv).
 */
export function allowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN?.trim()
  if (!raw) {
    return process.env.NODE_ENV === 'production' ? [] : ['*']
  }
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

/**
 * Decision 110 gap fix: "no SMTP configured" used to be treated as "we're in
 * dev, log the raw OTP/verification code" — but that's also what a
 * misconfigured production box, or CI, looks like. A code reaching a log
 * must now be an explicit, deliberate opt-in, never a side effect of a
 * missing env var.
 */
export function devSecretLoggingEnabled(): boolean {
  return process.env.LOG_DEV_SECRETS === 'true'
}

/**
 * Media storage configuration (decisions 126/127/129). Limits live in env,
 * not code (decision 129); the blob backend is selected here so swapping
 * MinIO for a paid provider is a config change (decision 126).
 */
export interface MediaConfig {
  /** 'fs' (dev/test) or 's3' (MinIO in the MVP, paid provider later). */
  blobStore: 'fs' | 's3'
  fsRoot: string
  s3: { endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string }
  maxBytes: number
  maxPerReport: number
  /** Decision 136: pending media never attached expires after this many
   *  hours — config, not a constant. */
  orphanTtlHours: number
  /** Decision 127: avatar class is specified but OFF in the MVP. */
  avatarEnabled: boolean
}

export function mediaConfig(): MediaConfig {
  const blobStore = process.env.BLOB_STORE === 's3' ? 's3' : 'fs'
  return {
    blobStore,
    fsRoot: process.env.MEDIA_FS_ROOT || 'data/media',
    s3: {
      endpoint: (process.env.S3_ENDPOINT ?? '').replace(/\/$/, ''),
      region: process.env.S3_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET ?? '',
      accessKey: process.env.S3_ACCESS_KEY ?? '',
      secretKey: process.env.S3_SECRET_KEY ?? '',
    },
    maxBytes: Number(process.env.MEDIA_MAX_BYTES ?? 10 * 1024 * 1024),
    maxPerReport: Number(process.env.MEDIA_MAX_PER_REPORT ?? 10),
    orphanTtlHours: Number(process.env.MEDIA_ORPHAN_TTL_HOURS ?? 48),
    avatarEnabled: process.env.AVATAR_ENABLED === 'true',
  }
}

/**
 * Payment rail configuration (decisions 96, 100, 143). PAYMENT_RAIL only
 * has one value today ('asaas') — a candidate found while researching the
 * decision-59 checklist, NOT yet the closed choice. Sandbox by default
 * (decision 79): nothing here should touch real money without an explicit
 * production URL.
 */
export interface PaymentConfig {
  rail: 'asaas'
  asaas: { apiUrl: string; apiKey: string; escrowDaysToExpire: number }
}

export function paymentConfig(): PaymentConfig {
  return {
    rail: 'asaas',
    asaas: {
      apiUrl: process.env.ASAAS_API_URL || 'https://api-sandbox.asaas.com',
      apiKey: process.env.ASAAS_API_KEY ?? '',
      escrowDaysToExpire: Number(process.env.ASAAS_ESCROW_DAYS_TO_EXPIRE ?? 30),
    },
  }
}

/**
 * Mediation discipline (decisions 148/149): days between a resolution's
 * dual-control approval and the earliest allowed execution — the window
 * in which the case's parties can contest. Must fit inside the rail's
 * retention period (ASAAS_ESCROW_DAYS_TO_EXPIRE).
 */
export function mediationContestWindowDays(): number {
  return Number(process.env.MEDIATION_CONTEST_WINDOW_DAYS ?? 7)
}

/**
 * Masked chat limits (decision 177): the MVP numbers are configuration,
 * not decisions — 30 messages per minute per thread per participant and
 * 1000 characters per message by default. The rate window is counted in
 * the database (no in-memory state), so every instance enforces the same
 * number.
 */
export interface ChatConfig {
  maxLength: number
  ratePerMinute: number
}

export function chatConfig(): ChatConfig {
  const maxLength = Number(process.env.CHAT_MAX_LENGTH ?? 1000)
  const ratePerMinute = Number(process.env.CHAT_RATE_PER_MINUTE ?? 30)
  return {
    maxLength: Number.isFinite(maxLength) && maxLength > 0 ? maxLength : 1000,
    ratePerMinute: Number.isFinite(ratePerMinute) && ratePerMinute > 0 ? ratePerMinute : 30,
  }
}

/** Boot-time validation — called by server.ts before listening. */
export function assertRequiredEnv(): void {
  if (process.env.NODE_ENV !== 'production') return
  if (!process.env.JWT_SECRET) {
    throw new Error('Refusing to start in production without JWT_SECRET')
  }
  const origins = allowedOrigins()
  if (origins.length === 0 || origins.includes('*')) {
    throw new Error(
      'Refusing to start in production without an explicit CORS_ORIGIN allowlist (decision 115)'
    )
  }
  if (!process.env.LEGAL_KEK) {
    throw new Error('Refusing to start in production without LEGAL_KEK (decision 111)')
  }
  if (!process.env.MEDIA_KEK) {
    throw new Error('Refusing to start in production without MEDIA_KEK (decision 126)')
  }
  const media = mediaConfig()
  if (media.blobStore === 's3') {
    const { endpoint, bucket, accessKey, secretKey } = media.s3
    if (!endpoint || !bucket || !accessKey || !secretKey) {
      throw new Error(
        'BLOB_STORE=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY (decision 126)'
      )
    }
  }
}
