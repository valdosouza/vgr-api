import { z } from 'zod'

export const preferencesUpdateDto = z.object({
  // BCP-47-ish tags the app ships translations for (en-US source, pt-BR
  // first translation — app ADR §INTERNATIONALIZATION).
  locale: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Must be a locale tag like en-US or pt-BR'),
})

export type PreferencesUpdateInput = z.infer<typeof preferencesUpdateDto>
