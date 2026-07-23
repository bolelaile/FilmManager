import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import log from 'electron-log'
import sharp from 'sharp'

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
  thumbDir: string
): Promise<string | null> {
  try {
    fs.mkdirSync(thumbDir, { recursive: true })
    const hash = createHash('md5').update(sourcePath).digest('hex')
    const thumbPath = path.join(thumbDir, `${hash}.webp`)

    if (fs.existsSync(thumbPath)) return thumbPath

    const ext = path.extname(sourcePath).toLowerCase()

    if (isRawFormat(ext)) {
      // 尝试 sharp 直接读取（部分 RAW 格式支持）
      let imgBuffer: Buffer | null = null
      try {
        imgBuffer = await sharp(sourcePath).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside' }).webp({ quality: 80 }).toBuffer()
      } catch {
        // 回退：提取嵌入 JPEG
        const rawBuf = fs.readFileSync(sourcePath)
        const embedded = extractEmbeddedJpeg(rawBuf)
        if (embedded) {
          imgBuffer = await sharp(embedded)
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
      await sharp(sourcePath)
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
    const meta = await sharp(filePath).metadata()
    return { width: meta.width ?? 0, height: meta.height ?? 0 }
  } catch {
    return null
  }
}

export interface ExifData {
  shotDate: string | null   // YYYY-MM-DD
  cameraModel: string | null
}

/** 从 EXIF 提取拍摄日期和相机型号 */
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
        if (!embedded) return { shotDate: null, cameraModel: null }
        meta = await sharp(embedded).metadata()
      }
    } else {
      meta = await sharp(filePath).metadata()
    }

    let shotDate: string | null = null
    let cameraModel: string | null = null

    if (meta.exif) {
      try {
        const exifStr = meta.exif.toString('binary')
        // Parse DateTimeOriginal (tag 0x9003) — stored as ASCII "YYYY:MM:DD HH:MM:SS"
        const dateMatch = exifStr.match(/(\d{4}):(\d{2}):(\d{2}) \d{2}:\d{2}:\d{2}/)
        if (dateMatch) {
          const year = parseInt(dateMatch[1])
          if (year > 1970 && year < 2100) {
            shotDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
          }
        }
        // Parse camera Model tag — find "Model\0" followed by ASCII string
        const modelMatch = exifStr.match(/Model\0([^\0]{1,64})/)
        if (modelMatch) {
          cameraModel = modelMatch[1].replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '').trim() || null
        }
        // Also try Make + Model combo for common EXIF layouts
        if (!cameraModel) {
          const makeMatch = exifStr.match(/Make\0([^\0]{1,32})/)
          if (makeMatch) {
            cameraModel = makeMatch[1].replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '').trim() || null
          }
        }
      } catch {
        // EXIF parsing is best-effort
      }
    }

    return { shotDate, cameraModel }
  } catch {
    return { shotDate: null, cameraModel: null }
  }
}

/** 渲染全分辨率预览（用于全屏查看），可选应用 ICC 配置文件 */
export async function renderFullPreview(
  filePath: string,
  iccProfilePath?: string
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
      pipeline = sharp(filePath)
    }

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
