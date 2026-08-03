import sharp, { Sharp } from 'sharp'

/**
 * Ingest pipeline transforms (plano-imagens.md §4). The re-encode is the
 * load-bearing step: decoding and regenerating the image in one pass
 * removes ALL metadata (EXIF/GPS/serial — the reidentification vector that
 * threatens asset #1), kills any non-pixel payload smuggled in the file,
 * and normalizes cost. sharp strips metadata by default; `.rotate()` first
 * applies the EXIF orientation so stripping it doesn't turn photos
 * sideways.
 *
 * HEIC arrives at the API as JPEG: the prebuilt sharp binary has no HEIF
 * decoder (patent licensing), so converting at capture is the app's duty —
 * documented in api/docs/feature/media.md against decision 129's wording.
 */

/** Magic-byte sniffing — the client's Content-Type is never trusted. */
export function sniffMime(data: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (data.length < 12) return null
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return null
}

/** Single output format (decision 129). */
export const OUTPUT_MIME = 'image/webp'

const MAX_DIMENSION = 2048
const THUMB_DIMENSION = 320

export interface EncodedImage {
  data: Buffer
  width: number
  height: number
}

async function encode(pipeline: Sharp): Promise<EncodedImage> {
  const { data, info } = await pipeline.webp({ quality: 80 }).toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/** Decoded + re-encoded master copy: no metadata, capped dimensions. */
export async function normalize(data: Buffer): Promise<EncodedImage> {
  return encode(
    sharp(data)
      .rotate()
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
  )
}

export async function thumbnail(normalized: Buffer): Promise<EncodedImage> {
  return encode(
    sharp(normalized).resize(THUMB_DIMENSION, THUMB_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
  )
}

/**
 * Blurred feed derivative (decision 128). Generated at ingest for every
 * media — the category that decides whether the feed serves blur or thumb
 * only exists once a report references the media (M2), and the sharp
 * thumbnail must never reach a client just to be blurred there.
 */
export async function blurred(normalized: Buffer): Promise<EncodedImage> {
  return encode(
    sharp(normalized)
      .resize(THUMB_DIMENSION, THUMB_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .blur(24)
  )
}
