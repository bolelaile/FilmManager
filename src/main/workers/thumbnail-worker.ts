import { parentPort, workerData } from 'worker_threads'
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import sharp from 'sharp'

const THUMB_SIZE = 400

function isRawFormat(ext: string): boolean {
  return !['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.webp'].includes(ext)
}

function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const n = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360
  return n as 0 | 90 | 180 | 270
}

function decodeBmp(filePath: string): { buffer: Buffer; width: number; height: number; channels: 3 | 4 } | null {
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
        raw[dst] = data[src + 2]
        raw[dst + 1] = data[src + 1]
        raw[dst + 2] = data[src]
        if (channels === 4) raw[dst + 3] = data[src + 3]
      }
    }
    return { buffer: raw, width, height: absHeight, channels }
  } catch {
    return null
  }
}

function openSharp(filePath: string): sharp.Sharp {
  if (path.extname(filePath).toLowerCase() === '.bmp') {
    const raw = decodeBmp(filePath)
    if (raw) return sharp(raw.buffer, { raw: { width: raw.width, height: raw.height, channels: raw.channels } })
  }
  return sharp(filePath)
}

function extractEmbeddedJpeg(buf: Buffer): Buffer | null {
  let bestStart = -1, bestEnd = -1, bestSize = 0
  let pos = buf.length - 2
  while (pos > 100) {
    if (buf[pos] === 0xff && buf[pos + 1] === 0xd9) {
      const end = pos + 2
      for (let i = pos - 2; i >= 0; i--) {
        if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
          const size = end - i
          if (size > bestSize && size > 50000) { bestStart = i; bestEnd = end; bestSize = size }
          break
        }
      }
    }
    pos--
  }
  return bestStart !== -1 ? buf.slice(bestStart, bestEnd) : null
}

async function generateThumb(sourcePath: string, thumbDir: string, rotation = 0): Promise<string | null> {
  fs.mkdirSync(thumbDir, { recursive: true })
  const rot = normalizeRotation(rotation)
  const hashInput = rot === 0 ? sourcePath : `${sourcePath}:rotation:${rot}`
  const hash = createHash('md5').update(hashInput).digest('hex')
  const thumbPath = path.join(thumbDir, `${hash}.webp`)
  if (fs.existsSync(thumbPath)) return thumbPath

  const ext = path.extname(sourcePath).toLowerCase()
  try {
    if (isRawFormat(ext)) {
      let imgBuf: Buffer | null = null
      try {
        let p = sharp(sourcePath)
        if (rot) p = p.rotate(rot)
        imgBuf = await p.resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside' }).webp({ quality: 80 }).toBuffer()
      } catch {
        const rawBuf = fs.readFileSync(sourcePath)
        const embedded = extractEmbeddedJpeg(rawBuf)
        if (embedded) {
          let p = sharp(embedded)
          if (rot) p = p.rotate(rot)
          imgBuf = await p.resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside' }).webp({ quality: 80 }).toBuffer()
        }
      }
      if (imgBuf) { fs.writeFileSync(thumbPath, imgBuf); return thumbPath }
      return null
    } else {
      let p = openSharp(sourcePath)
      if (rot) p = p.rotate(rot)
      await p.resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside' }).webp({ quality: 80 }).toFile(thumbPath)
      return thumbPath
    }
  } catch {
    return null
  }
}

// Worker entrypoint: receive tasks from main thread via messages
if (parentPort) {
  parentPort.on('message', async (task: { id: number; sourcePath: string; thumbDir: string; rotation?: number }) => {
    try {
      const thumbPath = await generateThumb(task.sourcePath, task.thumbDir, task.rotation ?? 0)
      parentPort!.postMessage({ id: task.id, thumbPath, error: null })
    } catch (err) {
      parentPort!.postMessage({ id: task.id, thumbPath: null, error: String(err) })
    }
  })
}

// Standalone call when used as workerData payload (not used in pool mode, kept for compatibility)
if (workerData) {
  generateThumb(workerData.sourcePath, workerData.thumbDir, workerData.rotation ?? 0).then((thumbPath) => {
    parentPort?.postMessage({ thumbPath })
  })
}
