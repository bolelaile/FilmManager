/**
 * 导出管道：Canvas 渲染（参考 film-index-generator 方法）。
 * Sharp 仅负责 RAW 解码与（可选）背景模糊；边框/齿孔/边字/照片合成全部由
 * @napi-rs/canvas 的 film-frame-renderer 完成。
 */
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import log from 'electron-log'
import { getDb } from '../../db/index'
import {
  openSharp,
  extractEmbeddedJpeg,
  isRawFormat,
  normalizeRotation,
  getExifData
} from '../thumbnail'
import {
  getPhotoFilmFormat,
  getPhotoFilmSizeType,
  getPhotoCameraFormatInfo,
  getPhotoAttrValue,
  resolveFilmFormat
} from '../film-format'
import { renderFilmFrame, FORMAT_DEFINITIONS, type FilmFormatId } from './film-frame-renderer'
import { resolveStock } from './stock-presets'
import type {
  ExportConfig,
  BorderMatchResult
} from '../../../shared/export-types'
import { filmFormatToId } from '../../../shared/export-types'

// ── 常量 ────────────────────────────────────────────────────────────────────
const MAX_OUTPUT_LONG_EDGE = 16384

interface PhotoRow {
  id: number
  file_path: string
  original_name: string
  width: number | null
  height: number | null
  rotation: 0 | 90 | 180 | 270
  shot_date: string | null
  imported_at: string
}

function getPhotoRow(photoId: number): PhotoRow | null {
  const db = getDb()
  const row = db
    .prepare(
      'SELECT id, file_path, original_name, width, height, rotation, shot_date, imported_at FROM photos WHERE id = ?'
    )
    .get(photoId) as PhotoRow | undefined
  return row ?? null
}

/** 解码原图为 sharp 管道（复用 RAW + BMP + 嵌入 JPEG 回退），应用旋转 → 输出 PNG buffer 供 Canvas loadImage */
async function decodePhotoForCanvas(filePath: string, rotation: number): Promise<{ buffer: Buffer; width: number; height: number }> {
  const ext = path.extname(filePath).toLowerCase()
  const rot = normalizeRotation(rotation)
  let pipeline: sharp.Sharp
  if (isRawFormat(ext)) {
    try {
      pipeline = sharp(filePath)
      await pipeline.metadata()
    } catch {
      const rawBuf = fs.readFileSync(filePath)
      const embedded = extractEmbeddedJpeg(rawBuf)
      if (!embedded) throw new Error('无法解码 RAW 文件')
      pipeline = sharp(embedded)
    }
  } else {
    pipeline = openSharp(filePath)
  }
  if (rot) pipeline = pipeline.rotate(rot)
  // 输出 PNG 给 @napi-rs/canvas loadImage
  const { data, info } = await pipeline.png().toBuffer({ resolveWithObject: true })
  return { buffer: data, width: info.width, height: info.height }
}

// ── 自动匹配画幅 + 胶卷 stock ───────────────────────────────────────────────

export async function resolveBorderForPhoto(photoId: number): Promise<BorderMatchResult> {
  const photo = getPhotoRow(photoId)
  const photoWidth = photo?.width ?? null
  const photoHeight = photo?.height ?? null
  const filmAttr = getPhotoAttrValue(photoId, 'film')
  const stock = resolveStock(filmAttr)
  const stockLabel = `${stock.edgeText} · ${stock.process}`

  // 1. 优先读已存的 film_format 属性
  const fmt = getPhotoFilmFormat(photoId)
  if (fmt) {
    return { formatId: filmFormatToId(fmt), filmFormat: fmt, source: 'attr', photoWidth, photoHeight, stockLabel, stockEdgeText: stock.edgeText }
  }

  // 2. 无属性则现场检测
  if (photo && photo.width && photo.height) {
    const filmSizeType = getPhotoFilmSizeType(photoId)
    const cameraInfo = getPhotoCameraFormatInfo(photoId)
    const detected = await resolveFilmFormat(photo.file_path, photo.width, photo.height, filmSizeType, cameraInfo)
    if (detected) {
      return { formatId: filmFormatToId(detected), filmFormat: detected, source: 'detect', photoWidth, photoHeight, stockLabel, stockEdgeText: stock.edgeText }
    }
  }

  // 3. 默认 135
  return { formatId: '135', filmFormat: null, source: 'default', photoWidth, photoHeight, stockLabel, stockEdgeText: stock.edgeText }
}

// ── 边字 token 解析（用户自定义附加内容，叠加在 stock 边字之上） ─────────────

function formatShutter(seconds: number): string {
  if (seconds >= 1) return `${seconds.toFixed(1)}s`
  return `1/${Math.round(1 / seconds)}s`
}

function getPhotoRollName(photoId: number): string {
  try {
    const row = getDb().prepare(
      `SELECT r.name FROM rolls r JOIN photo_rolls pr ON pr.roll_id = r.id WHERE pr.photo_id = ? LIMIT 1`
    ).get(photoId) as { name: string } | undefined
    return row?.name ?? ''
  } catch { return '' }
}

function getPhotoLocationName(photoId: number): string {
  try {
    const row = getDb().prepare(
      `SELECT l.name FROM locations l JOIN photo_locations pl ON pl.location_id = l.id WHERE pl.photo_id = ? LIMIT 1`
    ).get(photoId) as { name: string } | undefined
    return row?.name ?? ''
  } catch { return '' }
}

export async function resolveTokens(photoId: number, frameNo: number, config: ExportConfig): Promise<Record<string, string>> {
  const photo = getPhotoRow(photoId)
  const tokens: Record<string, string> = {}
  if (photo) {
    tokens.original = photo.original_name.replace(/\.[^.]+$/, '')
    tokens.film = getPhotoAttrValue(photoId, 'film') ?? ''
    tokens.camera = getPhotoAttrValue(photoId, 'camera') ?? ''
    tokens.lens = getPhotoAttrValue(photoId, 'lens') ?? ''
    tokens.format = getPhotoFilmFormat(photoId) ?? ''
    tokens.date = (photo.shot_date ?? photo.imported_at ?? '').substring(0, 10).replace(/-/g, '.')
  }
  if (photo) {
    try {
      const exif = await getExifData(photo.file_path)
      tokens.iso = exif.iso != null ? String(exif.iso) : ''
      tokens.aperture = exif.fNumber != null ? `f/${exif.fNumber.toFixed(1)}` : ''
      tokens.shutter = exif.exposureTime != null ? formatShutter(exif.exposureTime) : ''
      tokens.focal = exif.focalLength != null ? `${Math.round(exif.focalLength)}mm` : ''
    } catch { tokens.iso = tokens.aperture = tokens.shutter = tokens.focal = '' }
  }
  tokens.roll = getPhotoRollName(photoId)
  tokens.location = getPhotoLocationName(photoId)
  const fn = config.frameNo
  const num = fn.start + (frameNo - 1) * fn.step
  tokens.frame_no = `${fn.prefix}${String(num).padStart(fn.digits, '0')}`
  tokens.frame_no_padded = String(num).padStart(fn.digits, '0')
  return tokens
}

// ── 长边计算 ────────────────────────────────────────────────────────────────

function resolveLongEdge(w: number, h: number, config: ExportConfig): number {
  const img = config.image
  if (img.longEdge) return Math.min(img.longEdge, MAX_OUTPUT_LONG_EDGE)
  if (img.scale) return Math.min(Math.round(Math.max(w, h) * img.scale), MAX_OUTPUT_LONG_EDGE)
  return Math.min(Math.max(w, h), MAX_OUTPUT_LONG_EDGE)
}

/** 解析画幅 id：手动 templateId 优先，否则 film_format 属性 */
function resolveFormatId(config: ExportConfig, photoId: number): FilmFormatId {
  if (config.border.formatId && config.border.formatId !== '135') return config.border.formatId
  const override = config.border.filmFormatOverride
  if (override) return filmFormatToId(override)
  const fmt = getPhotoFilmFormat(photoId)
  return filmFormatToId(fmt)
}

// ── 单张导出 ────────────────────────────────────────────────────────────────

export async function renderExport(
  photoId: number,
  config: ExportConfig,
  frameNo: number,
  outPath: string
): Promise<{ width: number; height: number; bytes: number }> {
  const photo = getPhotoRow(photoId)
  if (!photo) throw new Error(`照片 ${photoId} 不存在`)

  const decoded = await decodePhotoForCanvas(photo.file_path, photo.rotation)

  const formatId = resolveFormatId(config, photoId)
  const stock = resolveStock(getPhotoAttrValue(photoId, 'film'))
  const longEdge = resolveLongEdge(decoded.width, decoded.height, config)

  // 预下采样：导出目标长边的 2 倍供 zoom 冗余，避免大图全分辨率 PNG 占内存
  const targetCap = longEdge * 2
  let photoBuffer = decoded.buffer
  let photoW = decoded.width
  let photoH = decoded.height
  if (Math.max(decoded.width, decoded.height) > targetCap) {
    const ratio = targetCap / Math.max(decoded.width, decoded.height)
    const resized = await sharp(decoded.buffer)
      .resize(Math.round(decoded.width * ratio), Math.round(decoded.height * ratio), { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true })
    photoBuffer = resized.data
    photoW = resized.info.width
    photoH = resized.info.height
  }

  // 背景模糊 buffer（Sharp 预模糊）
  let blurBuffer: Buffer | null = null
  if (config.background.type === 'blur') {
    blurBuffer = await sharp(photoBuffer)
      .resize(Math.round(photoW * 0.3), Math.round(photoH * 0.3), { fit: 'inside' })
      .blur(config.background.blurSigma)
      .png()
      .toBuffer()
  }

  const buf = await renderFilmFrame({
    photoBuffer,
    photoW,
    photoH,
    formatId,
    stock,
    frameNo,
    crop: config.image.crop ?? null,
    background: { type: config.background.type, color: config.background.color, blurBuffer },
    longEdge,
    outputFormat: config.image.format,
    quality: config.image.quality
  })

  const finalPath = ensureExt(outPath, config.image.format === 'jpeg' ? 'jpg' : 'png')
  await fs.promises.mkdir(path.dirname(finalPath), { recursive: true })
  await fs.promises.writeFile(finalPath, buf)
  // 取输出尺寸
  const meta = await sharp(buf).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0, bytes: buf.length }
}

// ── 预览（小图 dataURL） ──────────────────────────────────────────────────────

export async function renderExportPreview(photoId: number, config: ExportConfig, maxLongEdge = 800): Promise<Buffer> {
  const photo = getPhotoRow(photoId)
  if (!photo) throw new Error(`照片 ${photoId} 不存在`)

  const decoded = await decodePhotoForCanvas(photo.file_path, photo.rotation)
  // 缩到预览尺寸降低 Canvas 负担
  const ratio = Math.min(1, maxLongEdge / Math.max(decoded.width, decoded.height))
  let previewBuffer = decoded.buffer
  let previewW = decoded.width
  let previewH = decoded.height
  if (ratio < 1) {
    const resized = await sharp(decoded.buffer)
      .resize(Math.round(decoded.width * ratio), Math.round(decoded.height * ratio), { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true })
    previewBuffer = resized.data
    previewW = resized.info.width
    previewH = resized.info.height
  }

  let blurBuffer: Buffer | null = null
  if (config.background.type === 'blur') {
    blurBuffer = await sharp(previewBuffer).resize(Math.round(previewW * 0.3), Math.round(previewH * 0.3), { fit: 'inside' }).blur(config.background.blurSigma).png().toBuffer()
  }

  const formatId = resolveFormatId(config, photoId)
  const stock = resolveStock(getPhotoAttrValue(photoId, 'film'))
  // 预览用较小 longEdge
  const previewLongEdge = Math.min(maxLongEdge, resolveLongEdge(decoded.width, decoded.height, config))

  return renderFilmFrame({
    photoBuffer: previewBuffer,
    photoW: previewW,
    photoH: previewH,
    formatId,
    stock,
    frameNo: 1,
    crop: config.image.crop ?? null,
    background: { type: config.background.type, color: config.background.color, blurBuffer },
    longEdge: previewLongEdge,
    outputFormat: 'jpeg',
    quality: 80
  })
}

// ── 文件命名 ──────────────────────────────────────────────────────────────────

function ensureExt(filePath: string, ext: string): string {
  const parsed = path.parse(filePath)
  return path.join(parsed.dir, `${parsed.name}.${ext}`)
}

export function buildFilename(template: string, tokens: Record<string, string>, index: number, ext: string): string {
  let name = template
    .replace(/\{(\w+)\}/g, (_, k: string) => tokens[k] ?? '')
    .replace(/\{index\}/g, String(index))
  name = name.replace(/[\\/:*?"<>|]/g, '_').trim() || `export_${index}`
  return `${name}.${ext}`
}

export function extForFormat(format: ExportConfig['image']['format']): string {
  return format === 'jpeg' ? 'jpg' : 'png'
}

export function resolveConflict(
  dir: string,
  filename: string,
  strategy: ExportConfig['output']['overwrite'],
  existing: Set<string>
): string | null {
  const fullPath = path.join(dir, filename)
  if (!existing.has(filename.toLowerCase())) {
    existing.add(filename.toLowerCase())
    return fullPath
  }
  if (strategy === 'skip') return null
  if (strategy === 'overwrite') return fullPath
  const parsed = path.parse(filename)
  let i = 2
  let candidate: string
  do {
    candidate = `${parsed.name}_${i}${parsed.ext}`
    i++
  } while (existing.has(candidate.toLowerCase()))
  existing.add(candidate.toLowerCase())
  return path.join(dir, candidate)
}
