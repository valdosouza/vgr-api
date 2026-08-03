export type FieldType = 'string' | 'number' | 'boolean' | 'date'

export interface FieldDefinition {
  name: string
  type: FieldType
  required: boolean
}

export interface CategoryFormSchemaRow {
  category: string
  fields: FieldDefinition[]
}
