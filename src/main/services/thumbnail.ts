import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import log from 'electron-log'
import sharp from 'sharp'
import exifReader from 'exif-reader'
import { nativeImage } from 'electron'

export const THUMB_SIZE = 400
export const SUPPORTED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.webp',
  '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2',
  '.orf', '.rw2', '.pef', '.raf', '.dng', '.raw', '.rwl',
  '.mrw', '.x3f', '.3fr', '.fff', '.iiq', '.mef'
])

export function isRawFormat(ext: string): boolean {
  return !['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.webp'].includes(ext.toLowerCase())
}

export function getFileType(filePath: string): string {
  return path.extname(filePath).toLowerCase().replace('.', '')
}

export function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360
  return normalized as 0 | 90 | 180 | 270
}

interface RawPixelData { buffer: Buffer; width: number; height: number; channels: 3 | 4 }

/**
 * 纯 JS 解析 BMP 文件，返回 RGB/RGBA 原始像素数据。
 * 支持 24bpp 和 32bpp 无压缩（compression=0）及位域（compression=3）格式，
 * 涵盖绝大多数相机/扫描仪输出的 BMP 文件。
 */
function decodeBmp(filePath: string): RawPixelData | null {
  try {
    const data = fs.readFileSync(filePath)
    if (data.length < 54 || data[0] !== 0x42 || data[1] !== 0x4D) return null
    const pixelDataOffset = data.readUInt32LE(10)
    const width = data.readInt32LE(18)
    const rawHeight = data.readInt32LE(22)
    const bitsPerPixel = data.readUInt16LE(28)
    const compression = data.readUInt32LE(30)
    if ((bitsPerPixel !== 24 && bitsPerPixel !== 32) || (compression !== 0 && compression !== 3)) return null
    if (width <= 0 || rawHeight === 0) return null
    const absHeight = Math.abs(rawHeight)
    const isTopDown = rawHeight < 0
    const bytesPerPixel = bitsPerPixel >> 3
    const rowStride = Math.floor((bitsPerPixel * width + 31) / 32) * 4
    const channels: 3 | 4 = bytesPerPixel === 4 ? 4 : 3
    const raw = Buffer.allocUnsafe(width * absHeight * channels)
    for (let row = 0; row < absHeight; row++) {
      const srcRow = isTopDown ? row : absHeight - 1 - row
      const rowBase = pixelDataOffset + srcRow * rowStride
      const dstBase = row * width * channels
      for (let col = 0; col < width; col++) {
        const src = rowBase + col * bytesPerPixel
        const dst = dstBase + col * channels
        raw[dst] = data[src + 2]     // R（BMP 以 BGR 顺序存储）
        raw[dst + 1] = data[src + 1] // G
        raw[dst + 2] = data[src]     // B
        if (channels === 4) raw[dst + 3] = data[src + 3] // A
      }
    }
    return { buffer: raw, width, height: absHeight, channels }
  } catch {
    return null
  }
}

/**
 * 创建适合处理该文件的 sharp 实例。
 * BMP 格式先通过纯 JS 解码器转为原始像素数据，
 * 再回退 nativeImage（兜底），其余格式直接传路径。
 */
function openSharp(filePath: string): sharp.Sharp {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.bmp') {
    const raw = decodeBmp(filePath)
    if (raw) {
      return sharp(raw.buffer, { raw: { width: raw.width, height: raw.height, channels: raw.channels } })
    }
    try {
      const img = nativeImage.createFromPath(filePath)
      if (!img.isEmpty()) return sharp(img.toPNG())
    } catch {}
  }
  return sharp(filePath)
}

/** 从 RAW 文件中提取嵌入的 JPEG 预览 */
function extractEmbeddedJpeg(rawBuffer: Buffer): Buffer | null {
  // 搜索最大的嵌入 JPEG（从文件末尾向前找 EOI，再找对应 SOI）
  let bestStart = -1
  let bestEnd = -1
  let bestSize = 0

  let searchPos = rawBuffer.length - 2
  while (searchPos > 100) {
    // 找 JPEG EOI 标记
    if (rawBuffer[searchPos] === 0xff && rawBuffer[searchPos + 1] === 0xd9) {
      const jpegEnd = searchPos + 2
      // 从当前位置向前找对应的 SOI
      for (let i = searchPos - 2; i >= 0; i--) {
        if (
          rawBuffer[i] === 0xff &&
          rawBuffer[i + 1] === 0xd8 &&
          rawBuffer[i + 2] === 0xff
        ) {
          const size = jpegEnd - i
          if (size > bestSize && size > 50000) {
            // 大于 50KB 才认为是有效的预览
            bestStart = i
            bestEnd = jpegEnd
            bestSize = size
          }
          break
        }
      }
    }
    searchPos--
  }

  if (bestStart !== -1) {
    return rawBuffer.slice(bestStart, bestEnd)
  }
  return null
}

/** 生成缩略图，返回缩略图文件路径 */
export async function generateThumbnail(
  sourcePath: string,
  thumbDir: string,
  rotation = 0
): Promise<string | null> {
  try {
    fs.mkdirSync(thumbDir, { recursive: true })
    const normalizedRotation = normalizeRotation(rotation)
    const hashInput = normalizedRotation === 0 ? sourcePath : `${sourcePath}:rotation:${normalizedRotation}`
    const hash = createHash('md5').update(hashInput).digest('hex')
    const thumbPath = path.join(thumbDir, `${hash}.webp`)

    if (fs.existsSync(thumbPath)) return thumbPath

    const ext = path.extname(sourcePath).toLowerCase()

    if (isRawFormat(ext)) {
      // 尝试 sharp 直接读取（部分 RAW 格式支持）
      let imgBuffer: Buffer | null = null
      try {
        let pipeline = sharp(sourcePath)
        if (normalizedRotation) pipeline = pipeline.rotate(normalizedRotation)
        imgBuffer = await pipeline.resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside' }).webp({ quality: 80 }).toBuffer()
      } catch {
        // 回退：提取嵌入 JPEG
        const rawBuf = fs.readFileSync(sourcePath)
        const embedded = extractEmbeddedJpeg(rawBuf)
        if (embedded) {
          let pipeline = sharp(embedded)
          if (normalizedRotation) pipeline = pipeline.rotate(normalizedRotation)
          imgBuffer = await pipeline
            .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside' })
            .webp({ quality: 80 })
            .toBuffer()
        }
      }
      if (imgBuffer) {
        fs.writeFileSync(thumbPath, imgBuffer)
        return thumbPath
      }
      return null
    } else {
      let pipeline = openSharp(sourcePath)
      if (normalizedRotation) pipeline = pipeline.rotate(normalizedRotation)
      await pipeline
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside' })
        .webp({ quality: 80 })
        .toFile(thumbPath)
      return thumbPath
    }
  } catch (err) {
    log.warn('Thumbnail generation failed for', sourcePath, err)
    return null
  }
}

/** 获取图片元数据（宽高） */
export async function getImageMeta(filePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const ext = path.extname(filePath).toLowerCase()
    if (isRawFormat(ext)) {
      // 从嵌入 JPEG 获取尺寸
      const rawBuf = fs.readFileSync(filePath)
      const embedded = extractEmbeddedJpeg(rawBuf)
      if (embedded) {
        const meta = await sharp(embedded).metadata()
        return { width: meta.width ?? 0, height: meta.height ?? 0 }
      }
      return null
    }
    const meta = await openSharp(filePath).metadata()
    return { width: meta.width ?? 0, height: meta.height ?? 0 }
  } catch {
    return null
  }
}

export interface ExifData {
  shotDate: string | null
  cameraMake: string | null
  cameraModel: string | null
  lensMake: string | null
  lensModel: string | null
}

const MAKER_ALIASES: { pattern: RegExp; name: string }[] = [
  { pattern: /^(NIKON|NIKON CORPORATION)/i, name: 'Nikon' },
  { pattern: /^CANON/i, name: 'Canon' },
  { pattern: /^(FUJIFILM|FUJI PHOTO FILM)/i, name: 'Fujifilm' },
  { pattern: /^SONY/i, name: 'Sony' },
  { pattern: /^OM DIGITAL/i, name: 'OM System' },
  { pattern: /^OLYMPUS/i, name: 'Olympus' },
  { pattern: /^(PANASONIC|MATSUSHITA)/i, name: 'Panasonic' },
  { pattern: /^LEICA/i, name: 'Leica' },
  { pattern: /^PENTAX/i, name: 'Pentax' },
  { pattern: /^RICOH/i, name: 'Ricoh' },
  { pattern: /^HASSELBLAD/i, name: 'Hasselblad' },
  { pattern: /^MAMIYA/i, name: 'Mamiya' },
  { pattern: /^PHASE ONE/i, name: 'Phase One' },
  { pattern: /^SIGMA/i, name: 'Sigma' },
  { pattern: /^TAMRON/i, name: 'Tamron' },
  { pattern: /^TOKINA/i, name: 'Tokina' },
  { pattern: /^(CARL ZEISS|ZEISS)/i, name: 'Zeiss' },
  { pattern: /^APPLE/i, name: 'Apple' },
  { pattern: /^GOOGLE/i, name: 'Google' }
]

function emptyExifData(): ExifData {
  return { shotDate: null, cameraMake: null, cameraModel: null, lensMake: null, lensModel: null }
}

function cleanMetadataText(value: unknown): string | null {
  if (value == null) return null
  let text: string
  if (Buffer.isBuffer(value)) {
    const looksUtf16 = value.length >= 4 && value[1] === 0 && value[3] === 0
    text = value.toString(looksUtf16 ? 'utf16le' : 'utf8')
  } else if (typeof value === 'string' || typeof value === 'number') {
    text = String(value)
  } else {
    return null
  }
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() || null
}

function standardizeMaker(value: unknown): string | null {
  const maker = cleanMetadataText(value)
  if (!maker) return null
  const alias = MAKER_ALIASES.find(({ pattern }) => pattern.test(maker))
  if (alias) return alias.name
  return maker
    .replace(/\s+(CORPORATION|CORP\.?|COMPANY|CO\.?|LTD\.?|LIMITED)(,?.*)?$/i, '')
    .trim() || maker
}

function equipmentKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function formatEquipmentName(makerValue: unknown, modelValue: unknown): string | null {
  const maker = standardizeMaker(makerValue)
  const model = cleanMetadataText(modelValue)
  if (!model) return maker
  if (!maker) return model

  const makerKey = equipmentKey(maker)
  const modelKey = equipmentKey(model)
  if (modelKey.startsWith(makerKey)) {
    return maker + model.slice(maker.length)
  }
  if (modelKey.includes(makerKey)) return model
  return `${maker} ${model}`
}

function formatExifDate(value: unknown): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null
  const year = value.getUTCFullYear()
  if (year <= 1970 || year >= 2100) return null
  return value.toISOString().slice(0, 10)
}

export function parseExifBuffer(buffer: Buffer): ExifData {
  try {
    const metadata = exifReader(buffer)
    const image = metadata.Image as Record<string, unknown> | undefined
    const photo = metadata.Photo as Record<string, unknown> | undefined
    const cameraMake = standardizeMaker(image?.Make)
    const lensMake = standardizeMaker(photo?.LensMake)
    const shotDate = formatExifDate(photo?.DateTimeOriginal)
      ?? formatExifDate(photo?.DateTimeDigitized)
      ?? formatExifDate(image?.DateTime)
    const cameraModel = formatEquipmentName(
      cameraMake,
      image?.Model ?? image?.UniqueCameraModel
    )
    const lensModel = formatEquipmentName(
      lensMake,
      photo?.LensModel ?? image?.LensModel
    )

    return { shotDate, cameraMake, cameraModel, lensMake, lensModel }
  } catch (err) {
    log.debug('EXIF parse failed', err)
    return emptyExifData()
  }
}

/** 从 EXIF 提取拍摄日期、相机和镜头型号 */
export async function getExifData(filePath: string): Promise<ExifData> {
  try {
    const ext = path.extname(filePath).toLowerCase()
    let meta: sharp.Metadata
    if (isRawFormat(ext)) {
      try {
        meta = await sharp(filePath).metadata()
      } catch {
        const rawBuf = fs.readFileSync(filePath)
        const embedded = extractEmbeddedJpeg(rawBuf)
        if (!embedded) return emptyExifData()
        meta = await sharp(embedded).metadata()
      }
      if (!meta.exif) {
        const rawBuf = fs.readFileSync(filePath)
        const embedded = extractEmbeddedJpeg(rawBuf)
        if (embedded) meta = await sharp(embedded).metadata()
      }
    } else {
      meta = await openSharp(filePath).metadata()
    }
    return meta.exif ? parseExifBuffer(meta.exif) : emptyExifData()
  } catch {
    return emptyExifData()
  }
}

/** 渲染全分辨率预览（用于全屏查看），可选应用 ICC 配置文件 */
export async function renderFullPreview(
  filePath: string,
  iccProfilePath?: string,
  rotation = 0
): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  try {
    const ext = path.extname(filePath).toLowerCase()
    let pipeline: sharp.Sharp

    if (isRawFormat(ext)) {
      // 尝试 sharp 直接解码
      try {
        pipeline = sharp(filePath)
        await pipeline.metadata() // 测试是否能读取
      } catch {
        // 回退：嵌入 JPEG
        const rawBuf = fs.readFileSync(filePath)
        const embedded = extractEmbeddedJpeg(rawBuf)
        if (!embedded) return null
        pipeline = sharp(embedded)
      }
    } else {
      pipeline = openSharp(filePath)
    }

    const normalizedRotation = normalizeRotation(rotation)
    if (normalizedRotation) pipeline = pipeline.rotate(normalizedRotation)

    // 应用 ICC 配置文件
    if (iccProfilePath && fs.existsSync(iccProfilePath)) {
      const iccBuffer = fs.readFileSync(iccProfilePath)
      pipeline = pipeline.withMetadata({ icc: iccBuffer.toString('base64') })
    }

    // 限制最大预览尺寸为 4096px（保护内存）
    pipeline = pipeline.resize(4096, 4096, { fit: 'inside', withoutEnlargement: true })
    pipeline = pipeline.jpeg({ quality: 95 })

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
    return { buffer: data, width: info.width, height: info.height }
  } catch (err) {
    log.error('Full preview render failed', filePath, err)
    return null
  }
}
