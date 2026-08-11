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

/**
 * 计算文件内容指纹：MD5(文件大小字节串 + 文件前 64KB 内容)
 * 速度快（无需读取完整文件），重复率极低，适合导入时快速去重。
 * 若读取失败则返回 null（不阻断导入流程）。
 */
export function computeContentHash(filePath: string): string | null {
  let fd: number | null = null
  try {
    const stat = fs.statSync(filePath)
    const sampleSize = Math.min(65536, stat.size)
    // 使用 alloc（清零）而非 allocUnsafe，避免部分读取时哈希混入未初始化内存
    const buffer = Buffer.alloc(sampleSize)
    fd = fs.openSync(filePath, 'r')
    fs.readSync(fd, buffer, 0, sampleSize, 0)
    return createHash('md5')
      .update(String(stat.size))
      .update(buffer)
      .digest('hex')
  } catch {
    return null
  } finally {
    // 无论 readSync 是否抛出，fd 都会被关闭
    if (fd !== null) try { fs.closeSync(fd) } catch {}
  }
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

// ── 胶片格式自动识别 ─────────────────────────────────────────────────────────

/**
 * 从给定宽度 × 高度的像素缓冲（Uint8Array, RGB, rows × cols × 3）中
 * 读取某一列 col 的亮度序列（简化为 R 通道）。
 */
function readColumnLuminance(buf: Buffer, width: number, height: number, col: number): number[] {
  const lum: number[] = new Array(height)
  for (let y = 0; y < height; y++) {
    lum[y] = buf[(y * width + col) * 3] // R channel only — fast approximation
  }
  return lum
}

/**
 * 检测一列亮度值序列中是否存在规律性的暗区（齿孔特征）。
 * 齿孔：宽约 2–3mm / 扫描图中几十像素，以约等间距重复。
 * 判定：暗区（亮度 < darkThreshold）占比 > 20%，且存在明显的明暗交替节奏。
 */
function hasSprocketPattern(lum: number[], darkThreshold: number): boolean {
  const darkCount = lum.filter((v) => v < darkThreshold).length
  const darkRatio = darkCount / lum.length
  if (darkRatio < 0.08 || darkRatio > 0.85) return false // 要么几乎全暗要么几乎全亮，都不是齿孔

  // 检测明暗转换次数（每次跨越阈值算一次）
  let transitions = 0
  let prevDark = lum[0] < darkThreshold
  for (let i = 1; i < lum.length; i++) {
    const isDark = lum[i] < darkThreshold
    if (isDark !== prevDark) {
      transitions++
      prevDark = isDark
    }
  }
  // 齿孔通常产生 4 次以上转换（至少 2 个完整孔）
  return transitions >= 4
}

/**
 * 检测图像边缘是否存在 120 胶卷背纸文字带：
 * 背纸文字带特征：顶部或底部有一条较亮的窄带（20–50px），亮度均值明显高于图像中心。
 */
function has120EdgeTextBand(buf: Buffer, width: number, height: number): boolean {
  if (height < 60) return false

  // 只取顶部 / 底部各 30px 一行的平均亮度
  const bandHeight = Math.min(30, Math.floor(height * 0.05))
  const centerY = Math.floor(height / 2)

  function rowAvgLum(y: number): number {
    let sum = 0
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3
      sum += (buf[idx] + buf[idx + 1] + buf[idx + 2]) / 3
    }
    return sum / width
  }

  // 中心行参考亮度
  const centerLum = rowAvgLum(centerY)

  // 检查顶部 bandHeight 行内是否有一行明显比中心亮
  for (let y = 0; y < bandHeight; y++) {
    if (rowAvgLum(y) > centerLum * 1.4 + 20) return true
  }
  // 检查底部 bandHeight 行
  for (let y = height - bandHeight; y < height; y++) {
    if (rowAvgLum(y) > centerLum * 1.4 + 20) return true
  }
  return false
}

/**
 * 根据长宽比和像素特征自动判断胶片格式。
 *
 * 返回值与 film_format 属性预设值完全一致：
 *   '135 / 35mm' | '半格 / 17.5mm' | '645 中画幅' | '6x6 中画幅' |
 *   '6x7 中画幅' | '6x8 中画幅' | '6x12 中画幅' | '120 中画幅' |
 *   '4x5 大画幅' | '8x10 大画幅' | null（置信度不足）
 *
 * 判断链：
 *  1. 先尝试采样图像边缘像素做深度分析
 *  2. 若深度分析失败（图像过小 / 读取失败），仅凭比例粗判
 */
export async function detectFilmFormat(
  filePath: string,
  width: number,
  height: number,
  filmSizeType?: '135' | '120' | 'both' | null
): Promise<string | null> {
  if (width <= 0 || height <= 0) return null

  // 确保 long 是长边
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  const ratio = long / short  // ≥ 1.0

  // 如果胶卷类型已知，直接按规则限制候选格式
  if (filmSizeType === '135') {
    // 仅在 135 格式里匹配：半格（比例约 1.33）或 135 标准（比例约 1.5）
    // 以 1.40 为分界：低于则半格，高于则 135 标准；超出 135 范围（>1.58）则不识别
    if (ratio <= 1.40) return '半格 / 17.5mm'
    if (ratio <= 1.58) return '135 / 35mm'
    return null
  }
  if (filmSizeType === '120') {
    // 仅在 120 格式里按比例匹配
    return classify120ByRatio(ratio)
  }

  // 尝试采样图像像素做深度分析（filmSizeType === 'both' | null | undefined）
  try {
    const ext = path.extname(filePath).toLowerCase()
    // 将图像缩小到最大 600×600 以节省内存；保持长宽比
    const sampleMaxDim = 600
    let pipeline: sharp.Sharp
    if (isRawFormat(ext)) {
      const rawBuf = fs.readFileSync(filePath)
      const embedded = extractEmbeddedJpeg(rawBuf)
      pipeline = embedded ? sharp(embedded) : sharp(filePath)
    } else {
      pipeline = openSharp(filePath)
    }
    const { data, info } = await pipeline
      .resize(sampleMaxDim, sampleMaxDim, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true })

    const sw = info.width
    const sh = info.height

    // 优先：6×6 正方形判断（比例 ≈ 1.0）—— 先于齿孔检测
    // 避免方形中画幅扫描边缘暗区被误判为齿孔
    if (Math.abs(ratio - 1.0) < 0.08) return '6x6 中画幅'

    // 检测齿孔：采样左侧第 2–6 列和右侧对称列
    const sprocketCols = [2, 4, 6, sw - 7, sw - 5, sw - 3]
      .filter((c) => c >= 0 && c < sw)
    const darkThreshold = 40 // 0-255，齿孔孔洞非常暗
    const sprocketHit = sprocketCols.filter((col) => {
      const lum = readColumnLuminance(data as unknown as Buffer, sw, sh, col)
      return hasSprocketPattern(lum, darkThreshold)
    }).length

    const hasSprocket = sprocketHit >= 2 // 至少两列检测到齿孔特征

    if (hasSprocket) {
      // 有齿孔 → 135 系列，按比例区分半格 vs 标准
      // 135 标准帧：24×36mm → 比例 1.5；半格：18×24mm → 比例约 1.33
      // 6×6 已在上方提前返回，此处 ratio < 1.45 仅剩半格
      if (ratio < 1.45) return '半格 / 17.5mm'
      return '135 / 35mm'
    }

    // 检测 120 背纸文字带；只有在有正向信号时才信任比例匹配
    const has120Edge = has120EdgeTextBand(data as unknown as Buffer, sw, sh)
    if (has120Edge) {
      const fmt = classify120ByRatio(ratio)
      if (fmt) return fmt
      return '120 中画幅' // 有边纸特征但比例异常，保守归为通用 120
    }

    // 无像素信号时降级为纯比例判断
  } catch {
    // 像素分析失败，降级为纯比例判断
  }

  return classifyByRatioOnly(ratio)
}

/**
 * 按比例匹配 120 中画幅各规格。
 * 注意：645（6/4.5=1.333）与 6×8（8/6=1.333）比例完全相同，无法区分，
 * 统一归为 645（更常见规格）。
 * 6×6 → 1.0；6×7 → 1.167；645/6×8 → 1.333；6×12 → 2.0
 */
function classify120ByRatio(ratio: number): string | null {
  if (Math.abs(ratio - 1.0) < 0.08) return '6x6 中画幅'
  if (ratio >= 1.10 && ratio <= 1.26) return '6x7 中画幅'
  if (ratio >= 1.27 && ratio <= 1.42) return '645 中画幅' // 覆盖 645(1.333) 和 6×8(1.333)
  if (ratio >= 1.88 && ratio <= 2.15) return '6x12 中画幅'
  return null
}

/**
 * 仅凭比例做最宽泛的格式判断（像素分析不可用时的降级路径）。
 * 仅在比例特征明确时才输出结果，模糊区间返回 null 避免误判。
 */
function classifyByRatioOnly(ratio: number): string | null {
  // 135 标准帧 24×36mm → 1.5（容差 ±0.08）
  if (ratio >= 1.42 && ratio <= 1.58) return '135 / 35mm'
  // 6×6 正方形 → 1.0（容差 ±0.08）
  if (Math.abs(ratio - 1.0) < 0.08) return '6x6 中画幅'
  // 6×7 → 1.167（容差 ±0.06）
  if (ratio >= 1.10 && ratio <= 1.23) return '6x7 中画幅'
  // 645 / 6×8 → 1.333（容差 ±0.07；半格比例相同但无齿孔信号时不输出）
  if (ratio >= 1.26 && ratio <= 1.40) return '645 中画幅'
  // 6×12 → 2.0（容差 ±0.12）
  if (ratio >= 1.88 && ratio <= 2.15) return '6x12 中画幅'
  // 4×5 大画幅 → 1.25，8×10 大画幅 → 1.25（与 6×8/645 重叠，无法仅靠比例区分，不输出）
  return null
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
