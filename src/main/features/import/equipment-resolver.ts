/**
 * EXIF 器材识别子模块（features/import 内部）。
 * 精确匹配→模糊匹配→别名匹配→自动收录（可选）。
 */
import log from 'electron-log'
import { getDb } from '../../db/index'

function normalizeEquipmentValue(value: string): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/\b(corporation|corp|company|co|limited|ltd)\b/g, '')
    .replace(/[^a-z0-9一-鿿]+/g, '')
}

function findEquipmentValue(values: { id: number; value: string }[], model: string): { id: number; value: string } | undefined {
  const modelKey = normalizeEquipmentValue(model)
  const exact = values.find((value) => normalizeEquipmentValue(value.value) === modelKey)
  if (exact) return exact
  return values
    .filter((value) => {
      const valueKey = normalizeEquipmentValue(value.value)
      return valueKey.length >= 4 && (modelKey.includes(valueKey) || valueKey.includes(modelKey))
    })
    .sort((a, b) => normalizeEquipmentValue(b.value).length - normalizeEquipmentValue(a.value).length)[0]
}

/** 为照片设置器材属性（camera/lens），按 EXIF/手动值匹配库中已有值，无匹配则可选自动收录 */
export function assignEquipmentAttribute(
  photoId: number, typeKey: 'camera' | 'lens', model: string | null, autoCreate: boolean
): void {
  if (!model) return
  try {
    const db = getDb()
    const attributeType = db.prepare('SELECT id FROM attribute_types WHERE key = ?').get(typeKey) as { id: number } | undefined
    if (!attributeType) return
    const values = db.prepare('SELECT id, value FROM attribute_values WHERE attribute_type_id = ?').all(attributeType.id) as { id: number; value: string }[]
    const aliases = db.prepare(`
      SELECT ava.value_id AS id, ava.alias AS value FROM attribute_value_aliases ava
      JOIN attribute_values av ON av.id = ava.value_id WHERE av.attribute_type_id = ?
    `).all(attributeType.id) as { id: number; value: string }[]
    let value = findEquipmentValue(values, model) ?? findEquipmentValue(aliases, model)
    if (!value && autoCreate) {
      db.prepare('INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, is_preset) VALUES (?, ?, 0)').run(attributeType.id, model)
      value = db.prepare('SELECT id, value FROM attribute_values WHERE attribute_type_id = ? AND value = ? COLLATE NOCASE').get(attributeType.id, model) as { id: number; value: string } | undefined
    }
    if (value) {
      db.prepare('INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)').run(photoId, attributeType.id, value.id)
    }
  } catch (err) {
    log.warn(`EXIF ${typeKey} match failed`, err)
  }
}
