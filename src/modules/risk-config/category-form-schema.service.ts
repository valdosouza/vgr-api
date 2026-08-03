import * as repository from './category-form-schema.repository'
import { FieldDefinition } from './category-form-schema.interface'

/** Same TTL-cache shape as risk-config.service.ts (decision 46/47). */
const TTL_MS = 60_000
const cache = new Map<string, { fields: FieldDefinition[]; expiresAt: number }>()

export async function getCategoryFormSchema(category: string): Promise<FieldDefinition[]> {
  const cached = cache.get(category)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.fields
  }

  const row = await repository.findCategoryFormSchemaByCategory(category)
  const fields = row?.fields ?? []
  cache.set(category, { fields, expiresAt: Date.now() + TTL_MS })
  return fields
}

export async function setCategoryFormSchema(category: string, fields: FieldDefinition[]): Promise<void> {
  await repository.upsertCategoryFormSchema(category, fields)
  cache.delete(category)
}

/** Not TTL-cached — the admin list view always reads the current DB state. */
export async function listCategoryFormSchemas() {
  return repository.findAllCategoryFormSchemas()
}

/** Used by SubmitReport (task 24 wiring) to validate detail fields server-side. */
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
