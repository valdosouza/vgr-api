import pool from '@shared/db/connection'

/**
 * Read side of CategoryFormSchema (decision 47), promoted from
 * modules/risk-config when SubmitReport became a consumer (report-front
 * amendment E8 — the promotion tasks 24/32 already flagged as pending a
 * forcing consumer). The risk-config module keeps the admin CRUD and
 * delegates reads here so there is exactly ONE cache to invalidate.
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'date'

export interface FieldDefinition {
  name: string
  type: FieldType
  required: boolean
}

/** Same TTL-cache shape as risk-config.service.ts (decisions 46/47). */
const TTL_MS = 60_000
const cache = new Map<string, { fields: FieldDefinition[]; expiresAt: number }>()

export async function getCategoryFormSchema(category: string): Promise<FieldDefinition[]> {
  const cached = cache.get(category)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.fields
  }
  const [rows] = await pool.query<any[]>(
    `SELECT fields FROM tb_category_form_schema WHERE category = ?`,
    [category]
  )
  const fields: FieldDefinition[] = rows[0] ? JSON.parse(rows[0].fields) : []
  cache.set(category, { fields, expiresAt: Date.now() + TTL_MS })
  return fields
}

/** Called by the admin write path (risk-config module) after an upsert. */
export function invalidateCategoryFormCache(category?: string): void {
  if (category === undefined) cache.clear()
  else cache.delete(category)
}

/** Server-side detail-field validation for SubmitReport (decision 47). */
export async function validateReportDetailFields(
  category: string,
  submittedFields: Record<string, unknown>
): Promise<string[]> {
  const schema = await getCategoryFormSchema(category)
  const errors: string[] = []
  for (const field of schema) {
    const value = submittedFields[field.name]
    if (field.required && (value === undefined || value === null)) {
      errors.push(`${field.name} is required`)
    }
  }
  return errors
}
