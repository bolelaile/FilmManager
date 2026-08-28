/**
 * 图像处理纯工具（基础设施层）。
 * 从 services/thumbnail.ts 抽取的无 Electron/DB 依赖纯函数，供功能核心层复用。
 * 含 nativeImage 的 openSharp 仍保留在 thumbnail.ts（Electron 耦合）。
 */
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

/** 支持的图像扩展名（普通 + RAW） */
export const SUPPORTED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.webp',
  '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2',
  '.orf', '.rw2', '.pef', '.raf', '.dng', '.raw', '.rwl',
  '.mrw', '.x3f', '.3fr', '.fff', '.iiq', '.mef'
])

/** 是否 RAW 格式（非普通格式即视为 RAW） */
export function isRawFormat(ext: string): boolean {
  return !['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.webp'].includes(ext.toLowerCase())
}

/** 取文件类型（小写扩展名，无点） */
export function getFileType(filePath: string): string {
  return path.extname(filePath).toLowerCase().replace('.', '')
}

/** 旋转角度规范化到 0/90/180/270（顺时针） */
export function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360
  return normalized as 0 | 90 | 180 | 270
}

/**
 * 计算文件内容指纹：MD5(文件大小字节串 + 文件前 64KB 内容)。
 * 速度快（无需读取完整文件），重复率极低，适合导入时快速去重。
 */
export function computeContentHash(filePath: string): string | null {
  let fd: number | null = null
  try {
    const stat = fs.statSync(filePath)
    const sampleSize = Math.min(65536, stat.size)
    const buffer = Buffer.alloc(sampleSize)
    fd = fs.openSync(filePath, 'r')
    fs.readSync(fd, buffer, 0, sampleSize, 0)
    return createHash('md5').update(String(stat.size)).update(buffer).digest('hex')
  } catch {
    return null
  } finally {
    if (fd !== null) try { fs.closeSync(fd) } catch {}
  }
}

/** 从 RAW 文件缓冲中提取最大的嵌入 JPEG 预览（>50KB） */
export function extractEmbeddedJpeg(rawBuffer: Buffer): Buffer | null {
  let bestStart = -1
  let bestEnd = -1
  let bestSize = 0
  let searchPos = rawBuffer.length - 2
  while (searchPos > 100) {
    if (rawBuffer[searchPos] === 0xff && rawBuffer[searchPos + 1] === 0xd9) {
      const jpegEnd = searchPos + 2
      for (let i = searchPos - 2; i >= 0; i--) {
        if (rawBuffer[i] === 0xff && rawBuffer[i + 1] === 0xd8 && rawBuffer[i + 2] === 0xff) {
          const size = jpegEnd - i
          if (size > bestSize && size > 50000) {
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
  if (bestStart !== -1) return rawBuffer.slice(bestStart, bestEnd)
  return null
}

/** BMP 纯 JS 解码：返回 RGB/RGBA 原始像素数据（24/32bpp 无压缩 + 位域） */
export function decodeBmp(filePath: string): { buffer: Buffer; width: number; height: number; channels: 3 | 4 } | null {
  try {
    const data = fs.readFileSync(filePath)
    if (data.length < 54 || data[0] !== 0x42 || data[1] !== 0x4d) return null
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
