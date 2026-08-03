import sharp from 'sharp'
import { blurred, normalize, sniffMime, thumbnail } from '@modules/media/media-pipeline'

/** JPEG fixture WITH EXIF — what a phone camera actually sends. */
async function jpegWithExif(width = 64, height = 64): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#0a0' } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: 'holder', ImageDescription: 'gps-stand-in' } } })
    .toBuffer()
}

describe('media-pipeline (plano-imagens.md §4)', () => {
  describe('sniffMime — bytes decide, never the client header', () => {
    it('recognizes jpeg, png and webp', async () => {
      expect(sniffMime(await jpegWithExif())).toBe('image/jpeg')
      const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00f' } })
        .png()
        .toBuffer()
      expect(sniffMime(png)).toBe('image/png')
      const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00f' } })
        .webp()
        .toBuffer()
      expect(sniffMime(webp)).toBe('image/webp')
    })

    it('rejects non-image bytes regardless of any claimed type', () => {
      expect(sniffMime(Buffer.from('<script>alert(1)</script> padding padding'))).toBeNull()
      expect(sniffMime(Buffer.alloc(4))).toBeNull()
    })
  })

  describe('normalize — the re-encode that protects asset #1', () => {
    it('strips ALL metadata from the output', async () => {
      const source = await jpegWithExif()
      expect((await sharp(source).metadata()).exif).toBeDefined()

      const { data } = await normalize(source)
      const meta = await sharp(data).metadata()
      expect(meta.exif).toBeUndefined()
      expect(meta.icc).toBeUndefined()
      expect(meta.xmp).toBeUndefined()
    })

    it('outputs webp (decision 129 — single output format)', async () => {
      const { data } = await normalize(await jpegWithExif())
      expect(sniffMime(data)).toBe('image/webp')
    })

    it('caps dimensions without enlarging small images', async () => {
      const big = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#333' } })
        .jpeg()
        .toBuffer()
      const capped = await normalize(big)
      expect(capped.width).toBe(2048)
      expect(capped.height).toBe(1024)

      const small = await normalize(await jpegWithExif(64, 64))
      expect(small.width).toBe(64)
    })
  })

  it('thumbnail fits 320 and stays metadata-free', async () => {
    const { data: master } = await normalize(await jpegWithExif(1000, 500))
    const thumb = await thumbnail(master)
    expect(thumb.width).toBeLessThanOrEqual(320)
    expect((await sharp(thumb.data).metadata()).exif).toBeUndefined()
  })

  it('blurred derivative differs from the sharp thumbnail (decision 128)', async () => {
    // Noise, not a solid color — blurring a flat image can encode to the
    // exact same bytes as its thumbnail, which would fake a failure here.
    const noise = await sharp(Buffer.from(Array.from({ length: 400 * 400 * 3 }, (_, i) => (i * 2654435761) % 256)), {
      raw: { width: 400, height: 400, channels: 3 },
    })
      .jpeg()
      .toBuffer()
    const { data: master } = await normalize(noise)
    const [thumb, blur] = [await thumbnail(master), await blurred(master)]
    expect(blur.data.equals(thumb.data)).toBe(false)
    expect(sniffMime(blur.data)).toBe('image/webp')
  })
})
