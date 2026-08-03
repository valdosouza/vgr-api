import { createHash, randomUUID } from 'crypto'
import * as repository from '@modules/media/media.repository'
import { IngestInput, IngestResult, MediaVariant } from '@modules/media/media.interface'
import { blurred, normalize, OUTPUT_MIME, sniffMime, thumbnail } from '@modules/media/media-pipeline'
import { mediaConfig } from '@shared/config/env'
import { generateDek, sealBlob, openBlob, unwrapDek, wrapDek } from '@shared/crypto/media-cipher'
import { blobStore } from '@shared/storage/blob-store'
import { ErrorCodes, FieldErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function keyOf(prefix: string, variant: MediaVariant): string {
  return `${prefix.slice(0, 2)}/${prefix}/${variant}`
}

/**
 * Ingest (plano-imagens.md §4): sniff -> hash -> re-encode -> derivatives
 * -> seal -> record. Synchronous within the request on purpose — the
 * report itself never waits for this (decision 123): the app submits the
 * report first and uploads attachments from the offline queue (decision
 * 28) afterwards.
 */
export async function ingest(input: IngestInput): Promise<IngestResult> {
  const config = mediaConfig()

  if (input.class === 'avatar' && !config.avatarEnabled) {
    // Decision 127: the class is specified but OFF in the MVP.
    throw new HttpError(422, 'Avatar upload is not available', undefined, ErrorCodes.NOT_AVAILABLE)
  }

  if (input.data.length === 0 || input.data.length > config.maxBytes) {
    throw new HttpError(
      422,
      'File exceeds the size limit',
      [
        {
          field: 'file',
          message: 'File exceeds the size limit',
          code: FieldErrorCodes.TOO_LONG,
          params: { max: String(config.maxBytes) },
        },
      ],
      ErrorCodes.VALIDATION_FAILED
    )
  }

  const mimeOriginal = sniffMime(input.data)
  if (!mimeOriginal) {
    // The client's Content-Type is never consulted — bytes decide. HEIC is
    // converted to JPEG by the app at capture (see media-pipeline.ts).
    throw new HttpError(
      422,
      'Unsupported image format',
      [{ field: 'file', message: 'Unsupported image format', code: FieldErrorCodes.INVALID_FORMAT }],
      ErrorCodes.VALIDATION_FAILED
    )
  }

  if (input.keepOriginal && !input.exifWarningVersion) {
    // Decision 130 via the decision-86 pattern: the choice only counts
    // alongside the version of the warning text that produced it.
    throw new HttpError(
      422,
      'Keeping the original requires the warning text version',
      [
        {
          field: 'exifWarningVersion',
          message: 'Required when keepOriginal is true',
          code: FieldErrorCodes.REQUIRED,
        },
      ],
      ErrorCodes.VALIDATION_FAILED
    )
  }

  const sha256Original = sha256Hex(input.data)
  const master = await normalize(input.data)
  const [thumb, blur] = await Promise.all([thumbnail(master.data), blurred(master.data)])

  const dek = generateDek()
  const prefix = randomUUID()
  const store = blobStore()

  await Promise.all([
    store.put(keyOf(prefix, 'normalized'), sealBlob(dek, master.data)),
    store.put(keyOf(prefix, 'thumb'), sealBlob(dek, thumb.data)),
    store.put(keyOf(prefix, 'blur'), sealBlob(dek, blur.data)),
    ...(input.keepOriginal ? [store.put(keyOf(prefix, 'original'), sealBlob(dek, input.data))] : []),
  ])

  const publicId = randomUUID()
  await repository.insertMedia({
    publicId,
    class: input.class,
    uploaderAccountId: input.uploaderAccountId,
    status: 'available',
    mimeOriginal,
    mime: OUTPUT_MIME,
    bytesOriginal: input.data.length,
    bytes: master.data.length,
    width: master.width,
    height: master.height,
    sha256Original,
    sha256: sha256Hex(master.data),
    storagePrefix: prefix,
    keepOriginal: input.keepOriginal,
    exifWarningVersion: input.keepOriginal ? input.exifWarningVersion : null,
    dekWrapped: wrapDek(dek),
  })

  return {
    publicId,
    mime: OUTPUT_MIME,
    bytes: master.data.length,
    width: master.width,
    height: master.height,
  }
}

/**
 * App-plane read: strictly the uploader's own media (plan §5 — report
 * visibility and the audited panel access arrive with M2/M3). Everything
 * that must not be served answers 404, never 403: whether a media id
 * exists is itself information.
 */
export async function openVariant(
  publicId: string,
  variant: MediaVariant,
  accessorAccountId: number
): Promise<{ data: Buffer; mime: string }> {
  const notFound = () => new HttpError(404, 'Media not found', undefined, ErrorCodes.NOT_FOUND)

  const media = await repository.findByPublicId(publicId)
  if (!media || media.status !== 'available' || !media.dekWrapped) throw notFound()
  // Anonymous uploads have no owner to authenticate: they are served
  // through the report they belong to (M2), never through this route.
  if (media.uploaderAccountId === null || media.uploaderAccountId !== accessorAccountId) {
    throw notFound()
  }
  // The EXIF original is panel-only, behind privilege + audited reads
  // (decision 130) — the app never streams it.
  if (variant === 'original') throw notFound()

  const blob = await blobStore().get(keyOf(media.storagePrefix, variant))
  if (!blob) throw notFound()
  return { data: openBlob(unwrapDek(media.dekWrapped), blob), mime: media.mime }
}

/**
 * Panel read (M3, decision 130) — privilege and audit live at the route/
 * controller; this enforces what even a privileged reader can reach:
 * blocked media IS readable (a moderation hold preserves evidence for an
 * authority — that is its purpose), shredded media is gone, and the EXIF
 * original only exists when the reporter chose to keep it.
 */
export async function openVariantForPanel(
  publicId: string,
  variant: MediaVariant
): Promise<{ data: Buffer; mime: string }> {
  const notFound = () => new HttpError(404, 'Media not found', undefined, ErrorCodes.NOT_FOUND)

  const media = await repository.findByPublicId(publicId)
  if (!media || !media.dekWrapped) throw notFound()
  if (media.status !== 'available' && media.status !== 'blocked') throw notFound()
  if (variant === 'original' && !media.keepOriginal) throw notFound()

  const blob = await blobStore().get(keyOf(media.storagePrefix, variant))
  if (!blob) throw notFound()
  return {
    data: openBlob(unwrapDek(media.dekWrapped), blob),
    mime: variant === 'original' ? media.mimeOriginal : media.mime,
  }
}
