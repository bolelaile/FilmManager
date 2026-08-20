/**
 * 胶片格式识别共享模块。
 * 从 ipc/import.ts 抽取，供导入与导出共用，避免逻辑分叉。
 */
import log from 'electron-log'
import { getDb } from '../db/index'
import { detectFilmFormat } from './thumbnail'

/**
 * 相机画幅令牌 → film_format 属性值映射
 */
export const CAMERA_FORMAT_TOKEN_MAP: Record<string, string> = {
  '135': '135 / 35mm',
  '半格': '半格 / 17.5mm',
  '645': '645 中画幅',
  '6x6': '6x6 中画幅',
  '6x7': '6x7 中画幅',
  '6x8': '6x8 中画幅',
  '6x9': '6x9 中画幅',
  '6x12': '6x12 中画幅',
  'xpan': '135 宽幅 / Xpan',
  '4x5': '4x5 大画幅',
  '8x10': '8x10 大画幅'
}

/**
 * 读取胶卷 film_size_type（135 / 120 / both），约束格式自动识别范围。
 */
export function getPhotoFilmSizeType(
  photoId: number,
  filmName?: string | null
): '135' | '120' | 'both' | null {
  try {
    const db = getDb()
    const filmAttrType = db
      .prepare("SELECT id FROM attribute_types WHERE key = 'film'")
      .get() as { id: number } | undefined
    if (!filmAttrType) return null

    let sizeType: string | null = null

    if (filmName) {
      const row = db
        .prepare(
          `SELECT film_size_type FROM attribute_values WHERE attribute_type_id = ? AND LOWER(value) = LOWER(?)`
        )
        .get(filmAttrType.id, filmName) as { film_size_type: string | null } | undefined
      sizeType = row?.film_size_type ?? null
    }

    if (!sizeType) {
      const row = db
        .prepare(
          `SELECT av.film_size_type FROM photo_attributes pa
           JOIN attribute_values av ON av.id = pa.attribute_value_id
           WHERE pa.photo_id = ? AND pa.attribute_type_id = ?
           LIMIT 1`
        )
        .get(photoId, filmAttrType.id) as { film_size_type: string | null } | undefined
      sizeType = row?.film_size_type ?? null
    }

    if (sizeType === '135' || sizeType === '120' || sizeType === 'both') return sizeType
    return null
  } catch {
    return null
  }
}

/**
 * 查找相机画幅信息。
 * 返回 { formats: string[](film_format值列表), defaultFormat: string | null } 或 null（未知相机）。
 */
export function getPhotoCameraFormatInfo(
  photoId: number,
  cameraName?: string | null
): { formats: string[]; defaultFormat: string | null } | null {
  try {
    const db = getDb()
    const camAttrType = db
      .prepare("SELECT id FROM attribute_types WHERE key = 'camera'")
      .get() as { id: number } | undefined
    if (!camAttrType) return null

    let row: { camera_formats: string | null; camera_default_format: string | null } | undefined

    if (cameraName) {
      row = db
        .prepare(
          `SELECT camera_formats, camera_default_format FROM attribute_values
           WHERE attribute_type_id = ? AND LOWER(value) = LOWER(?)`
        )
        .get(camAttrType.id, cameraName) as typeof row
    }

    if (!row) {
      row = db
        .prepare(
          `SELECT av.camera_formats, av.camera_default_format FROM photo_attributes pa
           JOIN attribute_values av ON av.id = pa.attribute_value_id
           WHERE pa.photo_id = ? AND pa.attribute_type_id = ?
           LIMIT 1`
        )
        .get(photoId, camAttrType.id) as typeof row
    }

    if (!row?.camera_formats) return null

    const tokens = row.camera_formats.split(',').map((t) => t.trim()).filter(Boolean)
    const formats = tokens.map((t) => CAMERA_FORMAT_TOKEN_MAP[t]).filter(Boolean)
    const defaultFormat = row.camera_default_format
      ? CAMERA_FORMAT_TOKEN_MAP[row.camera_default_format] ?? null
      : null

    return formats.length > 0 ? { formats, defaultFormat } : null
  } catch {
    return null
  }
}

/**
 * 综合相机画幅信息和胶卷类型约束，确定最终胶片格式。
 * - 相机只有一种画幅：直接返回，无需像素分析
 * - 相机有多种画幅：取与 filmSizeType 相交后调用 detectFilmFormat
 * - 无相机信息：仅用 filmSizeType 约束调用 detectFilmFormat
 */
export async function resolveFilmFormat(
  filePath: string,
  width: number,
  height: number,
  filmSizeType: '135' | '120' | 'both' | null,
  cameraInfo: { formats: string[]; defaultFormat: string | null } | null
): Promise<string | null> {
  if (cameraInfo) {
    if (cameraInfo.formats.length === 1) {
      return cameraInfo.formats[0]
    }
    if (filmSizeType && filmSizeType !== 'both') {
      let filmFormatSet: Set<string>
      if (filmSizeType === '135') {
        filmFormatSet = new Set(['135 / 35mm', '半格 / 17.5mm', '135 宽幅 / Xpan'])
      } else {
        filmFormatSet = new Set([
          '645 中画幅',
          '6x6 中画幅',
          '6x7 中画幅',
          '6x8 中画幅',
          '6x9 中画幅',
          '6x12 中画幅',
          '120 中画幅'
        ])
      }
      const intersection = cameraInfo.formats.filter((f) => filmFormatSet.has(f))
      if (intersection.length === 1) return intersection[0]
      if (intersection.length === 0) {
        return cameraInfo.defaultFormat
      }
    }
  }
  return detectFilmFormat(filePath, width, height, filmSizeType)
}

/** 读取照片已存的 film_format 属性值 */
export function getPhotoFilmFormat(photoId: number): string | null {
  try {
    const db = getDb()
    const attrType = db
      .prepare("SELECT id FROM attribute_types WHERE key = 'film_format'")
      .get() as { id: number } | undefined
    if (!attrType) return null
    const row = db
      .prepare(
        `SELECT av.value FROM photo_attributes pa
         JOIN attribute_values av ON av.id = pa.attribute_value_id
         WHERE pa.photo_id = ? AND pa.attribute_type_id = ?
         LIMIT 1`
      )
      .get(photoId, attrType.id) as { value: string } | undefined
    return row?.value ?? null
  } catch {
    return null
  }
}

/** 读取照片某个属性类型的值（camera / film / lens 等） */
export function getPhotoAttrValue(photoId: number, key: string): string | null {
  try {
    const db = getDb()
    const attrType = db
      .prepare("SELECT id FROM attribute_types WHERE key = ?")
      .get(key) as { id: number } | undefined
    if (!attrType) return null
    const row = db
      .prepare(
        `SELECT av.value, av.icon_key FROM photo_attributes pa
         JOIN attribute_values av ON av.id = pa.attribute_value_id
         WHERE pa.photo_id = ? AND pa.attribute_type_id = ?
         LIMIT 1`
      )
      .get(photoId, attrType.id) as { value: string } | undefined
    return row?.value ?? null
  } catch {
    return null
  }
}

export function assignFilmFormatAttribute(photoId: number, formatValue: string): void {
  try {
    const db = getDb()
    const attrType = db
      .prepare("SELECT id FROM attribute_types WHERE key = 'film_format'")
      .get() as { id: number } | undefined
    if (!attrType) return

    const existing = db
      .prepare('SELECT 1 FROM photo_attributes WHERE photo_id = ? AND attribute_type_id = ?')
      .get(photoId, attrType.id)
    if (existing) return

    let val = db
      .prepare('SELECT id FROM attribute_values WHERE attribute_type_id = ? AND value = ?')
      .get(attrType.id, formatValue) as { id: number } | undefined

    if (!val) {
      db.prepare(
        'INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, is_preset) VALUES (?, ?, 0)'
      ).run(attrType.id, formatValue)
      val = db
        .prepare('SELECT id FROM attribute_values WHERE attribute_type_id = ? AND value = ?')
        .get(attrType.id, formatValue) as { id: number } | undefined
    }

    if (val) {
      db.prepare(
        'INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)'
      ).run(photoId, attrType.id, val.id)
    }
  } catch (err) {
    log.warn('assignFilmFormatAttribute failed', err)
  }
}
