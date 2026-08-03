import pool from '@shared/db/connection'
import { CategoryFormSchemaRow, FieldDefinition } from './category-form-schema.interface'

export async function findCategoryFormSchemaByCategory(
  category: string
): Promise<CategoryFormSchemaRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT category, fields FROM tb_category_form_schema WHERE category = ?`,
    [category]
  )
  if (!rows[0]) return null
  return { category: rows[0].category, fields: JSON.parse(rows[0].fields) }
}

export async function findAllCategoryFormSchemas(): Promise<CategoryFormSchemaRow[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT category, fields FROM tb_category_form_schema ORDER BY category`
  )
  return rows.map((row) => ({ category: row.category, fields: JSON.parse(row.fields) }))
}

export async function upsertCategoryFormSchema(
  category: string,
  fields: FieldDefinition[]
): Promise<void> {
  await pool.query(
    `INSERT INTO tb_category_form_schema (category, fields) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE fields = VALUES(fields)`,
    [category, JSON.stringify(fields)]
  )
}
