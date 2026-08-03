/** FieldType/FieldDefinition moved to @shared/risk/category-form (report-
 *  front amendment E8) — re-exported to keep the module surface stable. */
export type { FieldType, FieldDefinition } from '@shared/risk/category-form'
import type { FieldDefinition } from '@shared/risk/category-form'

export interface CategoryFormSchemaRow {
  category: string
  fields: FieldDefinition[]
}
