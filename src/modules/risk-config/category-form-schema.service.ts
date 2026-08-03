import * as repository from './category-form-schema.repository'
import { FieldDefinition } from './category-form-schema.interface'
import {
  getCategoryFormSchema as readSchema,
  invalidateCategoryFormCache,
  validateReportDetailFields as validateFields,
} from '@shared/risk/category-form'

/**
 * Admin CRUD stays here; the READ path (TTL cache + validation) moved to
 * @shared/risk/category-form when SubmitReport became a consumer
 * (report-front amendment E8) — one cache, invalidated on write.
 */
export async function getCategoryFormSchema(category: string): Promise<FieldDefinition[]> {
  return readSchema(category)
}

export async function setCategoryFormSchema(
  category: string,
  fields: FieldDefinition[]
): Promise<void> {
  await repository.upsertCategoryFormSchema(category, fields)
  invalidateCategoryFormCache(category)
}

/** Not TTL-cached — the admin list view always reads the current DB state. */
export async function listCategoryFormSchemas() {
  return repository.findAllCategoryFormSchemas()
}

/** Used by SubmitReport to validate detail fields server-side (decision 47). */
export async function validateReportDetailFields(
  category: string,
  submittedFields: Record<string, unknown>
): Promise<string[]> {
  return validateFields(category, submittedFields)
}
