/**
 * 胶片帧渲染器——封闭式统一入口（移植自参考项目 film-index-generator，MIT）。
 *
 * 封装完整性：对外仅暴露 renderFilmFrame + FORMAT_DEFINITIONS + FilmFormatId。
 * 内部模块（shared/frame-135/frame-generic/types）不对外泄露，调用方无法直接访问内部绘制函数。
 *
 * 调用方（exportPipeline.ts）仅需：
 *   import { renderFilmFrame, FORMAT_DEFINITIONS } from './frame-renderer'
 */
import { createCanvas, loadImage, type Canvas, type Image } from '@napi-rs/canvas'
import type { ResolvedStock } from '../stock-presets'
import { createSingleFrameOptions, renderSingleFrame, getSingleFrameRenderBounds, FORMAT_DEFINITIONS } from './frame-generic'
import type { FrameOptions, FrameItem, RenderBounds } from './types'

export { FORMAT_DEFINITIONS }

/** 导出画幅 id（与 export-types FilmFormatId 对齐） */
export type FilmFormatId = '135' | 'half' | 'xpan' | '135-69' | '645' | '66' | '67' | '69' | '612' | '617' | 'none'

/** pan/zoom 裁切选项 */
export interface CropOpts { zoom: number; offsetX: number; offsetY: number }

/** 渲染选项 */
export interface RenderFilmFrameOptions {
  /** 照片解码后的 PNG/JPEG buffer（用于 loadImage） */
  photoBuffer: Buffer
  photoW: number
  photoH: number
  formatId: FilmFormatId
  stock: ResolvedStock
  frameNo: number
  /** pan/zoom；null=居中 cover */
  crop?: CropOpts | null
  background: { type: 'transparent' | 'blur' | 'solid'; color: string; blurBuffer?: Buffer | null }
  /** 帧宽(像素，长边基准) */
  longEdge: number
  outputFormat: 'png' | 'jpeg'
  quality?: number
}

/**
 * 渲染单帧带边框照片。对外唯一入口。
 * 内部完成：loadImage → createOptions → 画布尺寸 → 背景 → pan/zoom cover → 渲染帧 → 编码。
 */
export async function renderFilmFrame(opts: RenderFilmFrameOptions): Promise<Buffer> {
  const { photoBuffer, photoW, photoH, formatId, stock, frameNo, crop, background, longEdge, outputFormat, quality } = opts
  const photo = await loadImage(photoBuffer)

  const frameW = longEdge
  const useFormat = formatId === 'none' ? '135' : formatId
  let fopts = createSingleFrameOptions({
    formatId: useFormat, frameW, stock, frameNumber: frameNo,
    showEdgeText: formatId !== 'none', showSprockets: formatId !== 'none',
  })
  if (formatId === 'none') {
    fopts = { ...fopts, showSprockets: false, showEdgeText: false, bandH: 0, textH: 0, stripH: fopts.slotH }
  }

  // 画布尺寸（含投影 padding，水平对称居中）
  const bounds: RenderBounds = getSingleFrameRenderBounds(fopts, formatId !== 'none')
  const canvasW = bounds.width
  const canvasH = bounds.height
  const canvas = createCanvas(canvasW, canvasH)
  const ctx = canvas.getContext('2d')

  // 背景
  if (background.type === 'transparent') {
    ctx.clearRect(0, 0, canvasW, canvasH)
  } else if (background.type === 'solid') {
    ctx.fillStyle = background.color
    ctx.fillRect(0, 0, canvasW, canvasH)
  } else if (background.blurBuffer) {
    const bgImg = await loadImage(background.blurBuffer)
    const scale = Math.max(canvasW / bgImg.width, canvasH / bgImg.height)
    const dw = bgImg.width * scale
    const dh = bgImg.height * scale
    ctx.drawImage(bgImg, (canvasW - dw) / 2, (canvasH - dh) / 2, dw, dh)
  }

  // pan/zoom cover 放置（扩展 getCoverPlacement，加 crop 钳制）
  const x = bounds.originX
  const y = bounds.originY
  const frameX = x + fopts.stripPadX
  const frameY = y + fopts.bandH
  const central = { x: frameX, y: frameY, w: fopts.slotW, h: fopts.slotH }

  // 计算照片 drawX/drawY/drawW/drawH（cover + pan/zoom 钳制）
  const placement = computePlacement(photoW, photoH, central, crop)
  const item: FrameItem = {
    source: photo as never,
    width: photoW,
    height: photoH,
  }

  if (formatId === 'none') {
    // 无边框：仅画照片
    ctx.save()
    ctx.beginPath()
    ctx.rect(central.x, central.y, central.w, central.h)
    ctx.clip()
    ctx.fillStyle = '#1b1b1b'
    ctx.fillRect(central.x, central.y, central.w, central.h)
    if (placement) ctx.drawImage(item.source, placement.drawX, placement.drawY, placement.drawW, placement.drawH)
    ctx.restore()
  } else {
    // 覆盖 drawFrame 内部的 placement——通过临时修改 item 的 width/height 不行，
    // 改为直接用 renderSingleFrame（它内部调 drawFrame 用 getCoverPlacement 无 crop）。
    // 为支持 pan/zoom，对 photo 预裁切：用 @napi-rs/canvas 的 extract 不便，
    // 改为在 renderSingleFrame 前用 clip + drawImage 手动绘制照片，跳过 drawFrame。
    // 但 renderSingleFrame 内部调 drawFrame 会覆盖——需用 custom draw。
    // 解决方案：对 photo 做预裁切生成新 Canvas，再作为 item.source 传入。
    const croppedPhoto = preCropPhoto(photo, photoW, photoH, central, crop)
    item.source = croppedPhoto
    item.width = croppedPhoto.width
    item.height = croppedPhoto.height

    renderSingleFrame(ctx, item, fopts, { x, y })
  }

  if (outputFormat === 'jpeg') {
    return canvas.toBuffer('image/jpeg', quality ?? 92)
  }
  return canvas.toBuffer('image/png')
}

/** cover 放置 + pan/zoom 钳制（始终填满） */
function computePlacement(srcW: number, srcH: number, central: { x: number; y: number; w: number; h: number }, crop?: CropOpts | null) {
  if (srcW <= 0 || srcH <= 0 || central.w <= 0 || central.h <= 0) return null
  const zoom = Math.max(1, crop?.zoom ?? 1)
  const scale = Math.max(central.w / srcW, central.h / srcH) * zoom
  const drawW = srcW * scale
  const drawH = srcH * scale
  const maxOffX = Math.max(0, drawW - central.w)
  const maxOffY = Math.max(0, drawH - central.h)
  const offX = crop ? Math.max(0, Math.min(maxOffX, crop.offsetX * maxOffX)) : maxOffX / 2
  const offY = crop ? Math.max(0, Math.min(maxOffY, crop.offsetY * maxOffY)) : maxOffY / 2
  return { scale, drawX: central.x - offX, drawY: central.y - offY, drawW, drawH }
}

/**
 * 预裁切照片：按 cover + pan/zoom 从原图裁出 central 区比例的子图，
 * 生成新 Canvas 作为 item.source，使 renderSingleFrame 内部的 getCoverPlacement
 * 正好 1:1 填满 central（无裁切损失）。
 */
function preCropPhoto(photo: Image, srcW: number, srcH: number, central: { w: number; h: number }, crop?: CropOpts | null): Canvas {
  // 计算 central 的目标比例
  const targetRatio = central.w / central.h
  const srcRatio = srcW / srcH
  const zoom = Math.max(1, crop?.zoom ?? 1)

  // cover 基准：从原图裁出 targetRatio 的最大区域
  let cropW: number, cropH: number, cropX: number, cropY: number
  if (srcRatio > targetRatio) {
    // 图更宽：按高度裁
    cropH = srcH
    cropW = srcH * targetRatio
  } else {
    cropW = srcW
    cropH = srcW / targetRatio
  }
  // zoom 缩小裁切区（放大照片）
  cropW = cropW / zoom
  cropH = cropH / zoom

  // pan 偏移（钳制在 [0, src-crop] 内）
  const maxPanX = srcW - cropW
  const maxPanY = srcH - cropH
  const panX = crop ? Math.max(0, Math.min(maxPanX, crop.offsetX * maxPanX)) : maxPanX / 2
  const panY = crop ? Math.max(0, Math.min(maxPanY, crop.offsetY * maxPanY)) : maxPanY / 2
  cropX = panX
  cropY = panY

  // 用 @napi-rs/canvas 裁切：创建 central 尺寸的 canvas，drawImage 从原图裁出
  const outW = Math.round(central.w)
  const outH = Math.round(central.h)
  const c = createCanvas(outW, outH)
  const cctx = c.getContext('2d')
  cctx.imageSmoothingEnabled = true
  cctx.imageSmoothingQuality = 'high'
  cctx.drawImage(photo as never, cropX, cropY, cropW, cropH, 0, 0, outW, outH)
  return c
}
