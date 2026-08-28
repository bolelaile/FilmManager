/**
 * 属性功能核心服务。
 * 封装属性类型/值 CRUD、faceted 联动计数、胶片图标、别名、JSON 批量导入。
 * 依赖 AttributeRepository；图标读取用注入的 iconsDir（隔离 electron app 路径）。
 */
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import type { AttributeRepository, AttrTypeRow, AttrValueRow, AliasRow } from '../../data/repositories/attribute-repository'
import type { QueryFilter } from '../../data/types'

export class AttributeService {
  constructor(
    private repo: AttributeRepository,
    private builtinIconsDir: string,
    private userIconsDir: string
  ) {}

  listTypes(): AttrTypeRow[] { return this.repo.listTypes() }
  listValues(typeId: number): AttrValueRow[] { return this.repo.listValues(typeId) }
  listAllWithValues(): (AttrTypeRow & { values: AttrValueRow[] })[] { return this.repo.listAllWithValues() }

  valueCounts(params?: QueryFilter) { return this.repo.valueCounts(params) }

  addType(displayName: string): number {
    const k = displayName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_一-鿿]/g, '')
    const types = this.repo.listTypes()
    const maxOrder = types.reduce((m, t) => Math.max(m, t.sort_order), 0)
    return this.repo.addType(displayName, k + '_' + Date.now(), maxOrder + 1)
  }
  updateType(id: number, displayName: string) { this.repo.updateType(id, displayName) }
  toggleType(id: number, active: boolean) { this.repo.toggleType(id, active) }
  deleteType(id: number) { this.repo.deleteType(id) }
  addValue(typeId: number, value: string, iconKey?: string) { return this.repo.addValue(typeId, value, iconKey) }
  updateValue(id: number, value: string, iconKey?: string) { this.repo.updateValue(id, value, iconKey) }
  deleteValue(id: number) { this.repo.deleteValue(id) }
  reorder(orderedIds: number[]) { this.repo.reorder(orderedIds) }
  listAliases(valueId: number): AliasRow[] { return this.repo.listAliases(valueId) }
  addAlias(valueId: number, alias: string) { return this.repo.addAlias(valueId, alias) }
  removeAlias(aliasId: number) { this.repo.removeAlias(aliasId) }
  importJson(typeId: number, entries: { value: string; aliases?: string[]; icon_key?: string }[]) {
    return this.repo.importJson(typeId, entries)
  }
  typeIdByKey(key: string) { return this.repo.typeIdByKey(key) }
  valueByTypeAndValue(typeId: number, value: string) { return this.repo.valueByTypeAndValue(typeId, value) }
  insertValueIgnore(typeId: number, value: string, isPreset?: number, iconKey?: string, filmSizeType?: string) {
    return this.repo.insertValueIgnore(typeId, value, isPreset, iconKey, filmSizeType)
  }
  photoAttrValue(photoId: number, typeKey: string) { return this.repo.photoAttrValue(photoId, typeKey) }

  // ── 胶片图标 ──
  /** manifest（iconKey -> displayName） */
  filmIconManifest(): Record<string, string> {
    try {
      const manifestPath = path.join(this.builtinIconsDir, 'manifest.json')
      if (!fs.existsSync(manifestPath)) return {}
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    } catch { return {} }
  }

  /** 解析图标路径（userData 优先，回退内置；防目录穿越） */
  private resolveIconPath(iconKey: string, suffix: string): string | null {
    if (!/^[a-zA-Z0-9_-]+$/.test(iconKey)) return null
    const userPath = path.join(this.userIconsDir, `${iconKey}${suffix}.webp`)
    if (fs.existsSync(userPath)) return userPath
    const builtinPath = path.join(this.builtinIconsDir, `${iconKey}${suffix}.webp`)
    if (fs.existsSync(builtinPath)) return builtinPath
    return null
  }

  filmIconDataUrl(iconKey: string, size: 64 | 128 = 64): string | null {
    const p = this.resolveIconPath(iconKey, size === 128 ? '@2x' : '')
    if (!p) return null
    try { return `data:image/webp;base64,${fs.readFileSync(p).toString('base64')}` } catch { return null }
  }

  filmIconsBatch(iconKeys: string[], size: 64 | 128 = 64): Record<string, string> {
    const result: Record<string, string> = {}
    const suffix = size === 128 ? '@2x' : ''
    for (const key of iconKeys) {
      const p = this.resolveIconPath(key, suffix)
      if (p) { try { result[key] = `data:image/webp;base64,${fs.readFileSync(p).toString('base64')}` } catch {} }
    }
    return result
  }

  /** 导入自定义图标：源图 → sharp 缩放 64/128px → 存入 userIconsDir */
  async importCustomIcon(srcPath: string): Promise<string | null> {
    const key = `custom_${Date.now()}`
    fs.mkdirSync(this.userIconsDir, { recursive: true })
    try {
      await sharp(srcPath).resize(64, 64, { fit: 'cover' }).webp({ quality: 90 }).toFile(path.join(this.userIconsDir, `${key}.webp`))
      await sharp(srcPath).resize(128, 128, { fit: 'cover' }).webp({ quality: 90 }).toFile(path.join(this.userIconsDir, `${key}@2x.webp`))
      return key
    } catch { return null }
  }
}
