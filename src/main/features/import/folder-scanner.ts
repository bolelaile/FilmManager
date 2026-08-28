/**
 * 文件夹扫描与名称解析子模块（features/import 内部）。
 * 模糊匹配胶片/相机/镜头属性、日期提取、地点匹配、题材提取。
 */
import fs from 'fs'
import path from 'path'
import { getDb } from '../../db/index'
import { SUPPORTED_EXTENSIONS } from '../../services/thumbnail'

export interface AttrMatch {
  typeId: number; valueId: number; value: string; key: string; iconKey?: string | null; matchedAlias: string | null
}
interface AliasRow { alias: string; value_id: number; attribute_type_id: number; icon_key?: string | null; type_key: string }
interface LocationRow { id: number; name: string; address: string }

export interface FolderScanResult {
  name: string; folderPath: string; fileCount: number
  matches: AttrMatch[]; parentMatches: AttrMatch[]
  parsedDate: string | null; inferredRollName: string
  parsedLocationId: number | null; parsedLocationName: string | null; parsedSubject: string | null
}
export interface RollImportConfig {
  folderPath: string; rollName: string; attrs: { typeId: number; valueId: number }[]
  locationId?: number | null; shotDate?: string | null; subLibraryId?: number | null
  createRoll: boolean; storageMode?: 'managed' | 'linked'
}

function normalize(s: string): string {
  return s.replace(/[\s\-_.]/g, '').toLowerCase()
}

/** 模糊匹配文件夹名与属性值/别名 */
function matchFolderName(
  folderName: string,
  allValues: { id: number; attribute_type_id: number; value: string; key: string; icon_key?: string | null }[],
  aliases: AliasRow[] = []
): AttrMatch[] {
  const norm = normalize(folderName)
  const matched: AttrMatch[] = []
  const seenTypes = new Set<number>()
  // Pass 1: 主名称匹配（按长度降序）
  const sorted = [...allValues].sort((a, b) => b.value.length - a.value.length)
  for (const v of sorted) {
    if (seenTypes.has(v.attribute_type_id)) continue
    const normVal = normalize(v.value)
    if (normVal.length < 2) continue
    if (norm.includes(normVal) || normVal.includes(norm)) {
      matched.push({ typeId: v.attribute_type_id, valueId: v.id, value: v.value, key: v.key, iconKey: v.icon_key ?? null, matchedAlias: null })
      seenTypes.add(v.attribute_type_id)
    }
  }
  // Pass 2: 别名匹配（填补未匹配类型）
  const sortedAliases = [...aliases].sort((a, b) => b.alias.length - a.alias.length)
  for (const a of sortedAliases) {
    if (seenTypes.has(a.attribute_type_id)) continue
    const normAlias = normalize(a.alias)
    if (normAlias.length < 2) continue
    if (norm.includes(normAlias) || normAlias.includes(norm)) {
      const primaryVal = allValues.find((v) => v.id === a.value_id)
      if (!primaryVal) continue
      matched.push({ typeId: a.attribute_type_id, valueId: a.value_id, value: primaryVal.value, key: a.type_key, iconKey: a.icon_key ?? null, matchedAlias: a.alias })
      seenTypes.add(a.attribute_type_id)
    }
  }
  return matched
}

function mergeMatches(child: AttrMatch[], parent: AttrMatch[]): AttrMatch[] {
  const result = [...child]
  const seenTypes = new Set(child.map((m) => m.typeId))
  for (const m of parent) { if (!seenTypes.has(m.typeId)) { result.push(m); seenTypes.add(m.typeId) } }
  return result
}

function parseDateFromName(name: string): string | null {
  const fullDate = name.match(/\b(20\d{2})[-_./]?(0[1-9]|1[0-2])[-_./]?(0[1-9]|[12]\d|3[01])\b/)
  if (fullDate) return `${fullDate[1]}-${fullDate[2]}-${fullDate[3]}`
  const yearMonth = name.match(/\b(20\d{2})[-_./]?(0[1-9]|1[0-2])\b/)
  if (yearMonth) return `${yearMonth[1]}-${yearMonth[2]}-01`
  const shortDate = name.match(/\b([2-9]\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/)
  if (shortDate) return `20${shortDate[1]}-${shortDate[2]}-${shortDate[3]}`
  const shortYM = name.match(/\b([2-9]\d)(0[1-9]|1[0-2])\b/)
  if (shortYM) return `20${shortYM[1]}-${shortYM[2]}-01`
  return null
}

function buildRollName(folderName: string, mergedMatches: AttrMatch[], parsedDate: string | null): string {
  const film = mergedMatches.find((m) => m.key === 'film')
  const fmt = mergedMatches.find((m) => m.key === 'film_format')
  if (!film && !fmt) return folderName
  const parts: string[] = []
  if (film) parts.push(film.value)
  if (fmt) parts.push(fmt.value)
  if (parsedDate) parts.push(parsedDate.slice(0, 7))
  return parts.join(' · ')
}

function matchLocationFromName(folderName: string, locations: LocationRow[]): { id: number; name: string } | null {
  const norm = normalize(folderName)
  const sorted = [...locations].sort((a, b) => b.name.length - a.name.length)
  for (const loc of sorted) {
    const normLoc = normalize(loc.name)
    if (normLoc.length < 2) continue
    if (norm.includes(normLoc)) return { id: loc.id, name: loc.name }
  }
  for (const loc of sorted) {
    const firstSeg = normalize(loc.address.split(',')[0] ?? loc.address)
    if (firstSeg.length >= 2 && norm.includes(firstSeg)) return { id: loc.id, name: loc.name }
  }
  return null
}

function extractSubject(folderName: string, attrMatches: AttrMatch[], locationMatch: { id: number; name: string } | null): string | null {
  let residual = folderName
    .replace(/\b20\d{2}[-_./]?(0[1-9]|1[0-2])([-_./]?(0[1-9]|[12]\d|3[01]))?\b/g, '')
    .replace(/\b[2-9]\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/g, '')
    .replace(/\b[2-9]\d(0[1-9]|1[0-2])\b/g, '')
  for (const m of attrMatches) {
    const target = m.matchedAlias ?? m.value
    const regex = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    residual = residual.replace(regex, '')
    residual = residual.replace(new RegExp(m.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
  }
  if (locationMatch) {
    const locRegex = new RegExp(locationMatch.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    residual = residual.replace(locRegex, '')
  }
  residual = residual.replace(/[\s\-_.[\]()\[\]]+/g, ' ').trim()
  if (!residual || residual.length < 2 || /^\d+$/.test(residual)) return null
  return residual
}

// 共用：加载可匹配属性 + 别名 + 地点
function loadMatchData() {
  const db = getDb()
  const matchableKeys = ['film', 'film_format', 'camera', 'lens']
  const allValues = db.prepare(`
    SELECT av.id, av.attribute_type_id, av.value, av.icon_key, at.key
    FROM attribute_values av JOIN attribute_types at ON at.id = av.attribute_type_id
    WHERE at.key IN (${matchableKeys.map(() => '?').join(',')}) ORDER BY LENGTH(av.value) DESC
  `).all(...matchableKeys) as { id: number; attribute_type_id: number; value: string; key: string; icon_key?: string | null }[]
  const allAliases = db.prepare(`
    SELECT ava.alias, ava.value_id, av.attribute_type_id, av.icon_key, at.key as type_key
    FROM attribute_value_aliases ava JOIN attribute_values av ON av.id = ava.value_id
    JOIN attribute_types at ON at.id = av.attribute_type_id
    WHERE at.key IN (${matchableKeys.map(() => '?').join(',')}) ORDER BY LENGTH(ava.alias) DESC
  `).all(...matchableKeys) as AliasRow[]
  const locations = db.prepare('SELECT id, name, address FROM locations ORDER BY LENGTH(name) DESC').all() as LocationRow[]
  return { allValues, allAliases, locations }
}

function walk(dir: string): string[] {
  const files: string[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) files.push(...walk(full))
      else { const ext = path.extname(entry.name).toLowerCase(); if (SUPPORTED_EXTENSIONS.has(ext)) files.push(full) }
    }
  } catch {}
  return files
}

/** 扫描根目录的子文件夹（每子文件夹为一卷） */
export function scanFolders(rootPath: string): { rootPath: string; folders: FolderScanResult[]; rootFileCount: number; rootMatches: AttrMatch[] } {
  const db = getDb()
  const { allValues, allAliases, locations } = loadMatchData()
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(rootPath, { withFileTypes: true }) } catch { return { rootPath, folders: [], rootFileCount: 0, rootMatches: [] } }
  const rootName = path.basename(rootPath)
  const rootMatches = matchFolderName(rootName, allValues, allAliases)
  const folders: FolderScanResult[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const folderPath = path.join(rootPath, entry.name)
    const files = walk(folderPath)
    if (files.length === 0) continue
    const childMatches = matchFolderName(entry.name, allValues, allAliases)
    const parsedDate = parseDateFromName(entry.name) ?? parseDateFromName(rootName)
    const mergedMatches = mergeMatches(childMatches, rootMatches)
    const inferredRollName = buildRollName(entry.name, mergedMatches, parsedDate)
    const locationMatch = matchLocationFromName(entry.name, locations)
    const subject = extractSubject(entry.name, mergedMatches, locationMatch)
    folders.push({
      name: entry.name, folderPath, fileCount: files.length,
      matches: childMatches, parentMatches: rootMatches, parsedDate, inferredRollName,
      parsedLocationId: locationMatch?.id ?? null, parsedLocationName: locationMatch?.name ?? null, parsedSubject: subject
    })
  }
  const rootFiles = fs.readdirSync(rootPath, { withFileTypes: true })
    .filter((e) => !e.isDirectory()).map((e) => path.join(rootPath, e.name))
    .filter((f) => SUPPORTED_EXTENSIONS.has(path.extname(f).toLowerCase()))
  return { rootPath, folders, rootFileCount: rootFiles.length, rootMatches }
}

/** 扫描单文件夹为一卷 */
export function scanSingleFolder(folderPath: string): { folderPath: string; folder: FolderScanResult } {
  const { allValues, allAliases, locations } = loadMatchData()
  const folderName = path.basename(folderPath)
  const files = walk(folderPath)
  const matches = matchFolderName(folderName, allValues, allAliases)
  const parsedDate = parseDateFromName(folderName)
  const locationMatch = matchLocationFromName(folderName, locations)
  const subject = extractSubject(folderName, matches, locationMatch)
  const inferredRollName = buildRollName(folderName, matches, parsedDate)
  const scanResult: FolderScanResult = {
    name: folderName, folderPath, fileCount: files.length, matches, parentMatches: [],
    parsedDate, inferredRollName, parsedLocationId: locationMatch?.id ?? null,
    parsedLocationName: locationMatch?.name ?? null, parsedSubject: subject
  }
  return { folderPath, folder: scanResult }
}
