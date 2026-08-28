/**
 * 胶片帧 Canvas 渲染器（移植自参考项目 film-index-generator 的 film-frame.js + film-frame-135.js，MIT）。
 *
 * 用 @napi-rs/canvas 在主进程绘制：片基(暖色渐变) + 齿孔(物理 pitch + 浮雕渐变) + 边字
 * (Courier 等宽 + glow + brand/preset 交替 + 帧号 + 条码) + 照片(cover 填满, pan/zoom 可调)。
 * 几何由物理 mm 驱动（pxPerMm），保证比例真实。
 */
import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas'
import type { ResolvedStock, FilmProcess } from './stock-presets'

// ── 135 物理常量（mm） ──────────────────────────────────────────────────────
const FILM_135 = Object.freeze({
  filmHeightMm: 35,
  imageHeightMm: 24,
  standardImageWidthMm: 36,
  frameAdvanceMm: 38,
  sprocketPitchMm: 4.75,
  sprocketHoleWidthMm: 2.8,
})

// ── 调参 ────────────────────────────────────────────────────────────────────
const TUNE_135 = Object.freeze({
  sprocketH: 0.1,       // 齿孔带高 / 帧宽
  holeH: 0.76,          // 齿孔高 / 齿孔带高
  holeW: 0.058,         // 齿孔宽 / 帧宽
  textH: 0.068,         // 边字带高 / 帧宽
  fontSize: 0.86,       // 字号 / 边字带高
  textOffsetY: 0.38,    // 边字 baseline 偏移
  textSprocketGap: 0.022,
})
const TUNE_120 = Object.freeze({
  fontSize120: 0.74,
  band120: 0.044,
  gap120: 0.085,
  textSprocketGap120: 0.015,
})

const EDGE_NUMBER_SUFFIX_SCALE = 0.68

// ── 画幅定义（移植参考 FORMAT_DEFINITIONS） ─────────────────────────────────
export type FilmFormatId = '135' | 'half' | 'xpan' | '135-69' | '645' | '66' | '67' | '69' | '612' | 'none'

interface FormatDef {
  id: FilmFormatId
  family: '135' | '120' | 'none'
  ratio: number
  imageWidthMm: number
  imageHeightMm: number
  portrait?: boolean
}

export const FORMAT_DEFINITIONS: Record<FilmFormatId, FormatDef> = {
  '135': { id: '135', family: '135', ratio: 36 / 24, imageWidthMm: 36, imageHeightMm: 24 },
  'half': { id: 'half', family: '135', ratio: 18 / 24, imageWidthMm: 18, imageHeightMm: 24 },
  'xpan': { id: 'xpan', family: '135', ratio: 65 / 24, imageWidthMm: 65, imageHeightMm: 24 },
  '135-69': { id: '135-69', family: '135', ratio: 84 / 24, imageWidthMm: 84, imageHeightMm: 24 },
  '645': { id: '645', family: '120', ratio: 41.5 / 56, imageWidthMm: 41.5, imageHeightMm: 56, portrait: true },
  '66': { id: '66', family: '120', ratio: 1, imageWidthMm: 56, imageHeightMm: 56 },
  '67': { id: '67', family: '120', ratio: 69.5 / 56, imageWidthMm: 69.5, imageHeightMm: 56 },
  '69': { id: '69', family: '120', ratio: 84 / 56, imageWidthMm: 84, imageHeightMm: 56 },
  '612': { id: '612', family: '120', ratio: 112 / 56, imageWidthMm: 112, imageHeightMm: 56 },
  'none': { id: 'none', family: 'none', ratio: 3 / 2, imageWidthMm: 36, imageHeightMm: 24 },
}

// ── 工具 ────────────────────────────────────────────────────────────────────
function deterministicNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function roundedRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rad)
    return
  }
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

// ── 几何选项 ────────────────────────────────────────────────────────────────
interface FrameOptions {
  format: FormatDef
  frameW: number
  frameH: number
  slotW: number
  slotH: number
  slotGap: number
  bandH: number
  sprocketH: number
  textH: number
  textSprocketShift: number
  sprocketPitch: number
  sprocketHoleW: number
  stripPadX: number
  edgeMarkW: number
  edgeMarkGap: number
  leaderAdvance: number
  showEdgeText: boolean
  showSprockets: boolean
  is120: boolean
  isHalfFrame: boolean
  isWide135: boolean
  stock: ResolvedStock
  frameNumber: number
  stripW: number
  stripH: number
}

function create135FamilyOptions(format: FormatDef, frameW: number, stock: ResolvedStock): FrameOptions {
  const effectiveFormat = format
  const pxPerMm = frameW / effectiveFormat.imageWidthMm
  const slotW = frameW
  const slotH = Math.round(pxPerMm * effectiveFormat.imageHeightMm)
  const textH = Math.round(frameW * TUNE_135.textH)
  const sprocketH = Math.round(frameW * TUNE_135.sprocketH)
  const textSprocketShift = Math.min(Math.round(frameW * TUNE_135.textSprocketGap), textH)
  const minimumBandH = Math.round(pxPerMm * (FILM_135.filmHeightMm - FILM_135.imageHeightMm) / 2)
  const bandH = Math.max(sprocketH + textH - textSprocketShift, minimumBandH)
  const slotGap = Math.max(0, pxPerMm * FILM_135.frameAdvanceMm - frameW)
  return {
    format, frameW, frameH: slotH, slotW, slotH, slotGap, bandH, sprocketH, textH, textSprocketShift,
    sprocketPitch: pxPerMm * FILM_135.sprocketPitchMm,
    sprocketHoleW: Math.round(frameW * TUNE_135.holeW),
    stripPadX: slotGap / 2,
    edgeMarkW: frameW,
    edgeMarkGap: slotGap,
    leaderAdvance: frameW + slotGap,
    showEdgeText: true, showSprockets: true, is120: false,
    isHalfFrame: format.id === 'half', isWide135: false,
    stock, frameNumber: 1,
    stripW: slotW + slotGap,
    stripH: slotH + bandH * 2,
  }
}

function create120Options(format: FormatDef, frameW: number, stock: ResolvedStock): FrameOptions {
  const slotW = frameW
  const slotH = Math.round(slotW / format.ratio)
  const textH = Math.round(slotH * TUNE_120.band120)
  const sprocketH = 0
  const textSprocketShift = 0
  const bandH = Math.max(textH, Math.round(slotH * 0.02))
  const slotGap = Math.round(slotH * TUNE_120.gap120)
  const stripPadX = Math.round(slotH * 0.05)
  return {
    format, frameW, frameH: slotH, slotW, slotH, slotGap, bandH, sprocketH, textH, textSprocketShift,
    sprocketPitch: slotH * (4.75 / 56),
    sprocketHoleW: slotH * (2.8 / 56),
    stripPadX,
    edgeMarkW: slotW,
    edgeMarkGap: slotGap,
    leaderAdvance: slotW + slotGap,
    showEdgeText: true, showSprockets: false, is120: true,
    isHalfFrame: false, isWide135: false,
    stock, frameNumber: 1,
    stripW: slotW + stripPadX * 2,
    stripH: slotH + bandH * 2,
  }
}

function createOptions(formatId: FilmFormatId, frameW: number, stock: ResolvedStock): FrameOptions {
  const format = FORMAT_DEFINITIONS[formatId] ?? FORMAT_DEFINITIONS['135']
  if (format.family === '120') return create120Options(format, frameW, stock)
  return create135FamilyOptions(format, frameW, stock)
}

// ── 片基表面（暖色渐变 + sheen + shadow + 描边） ───────────────────────────
function buildStripPath(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, opts: FrameOptions): void {
  const radius = opts.is120
    ? Math.max(2, Math.round(opts.frameW * 0.004))
    : Math.max(6, Math.round(opts.frameW * 0.015))
  roundedRect(ctx, x, y, w, h, radius)
}

function beginStripSurface(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, opts: FrameOptions): void {
  ctx.save()
  ctx.shadowColor = 'rgba(25, 20, 12, 0.35)'
  ctx.shadowBlur = Math.round(opts.frameW * 0.05)
  ctx.shadowOffsetY = Math.round(opts.frameW * 0.018)
  buildStripPath(ctx, x, y, w, h, opts)
  ctx.fillStyle = '#131110'
  ctx.fill()
  ctx.restore()

  ctx.save()
  buildStripPath(ctx, x, y, w, h, opts)
  ctx.clip()
  const base = ctx.createLinearGradient(0, y, 0, y + h)
  base.addColorStop(0, '#231e19')
  base.addColorStop(0.12, '#161311')
  base.addColorStop(0.5, '#191512')
  base.addColorStop(0.88, '#151210')
  base.addColorStop(1, '#241f1a')
  ctx.fillStyle = base
  ctx.fillRect(x, y, w, h)
  const sheen = ctx.createLinearGradient(x, y, x + w * 0.55, y + h)
  sheen.addColorStop(0, 'rgba(255, 250, 235, 0.05)')
  sheen.addColorStop(0.35, 'rgba(255, 250, 235, 0)')
  sheen.addColorStop(0.8, 'rgba(255, 250, 235, 0.025)')
  sheen.addColorStop(1, 'rgba(255, 250, 235, 0)')
  ctx.fillStyle = sheen
  ctx.fillRect(x, y, w, h)
}

function endStripSurface(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, opts: FrameOptions): void {
  ctx.restore()
  buildStripPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, opts)
  ctx.strokeStyle = 'rgba(255, 248, 230, 0.07)'
  ctx.lineWidth = 1
  ctx.stroke()
}

// ── 照片 cover 填满（扩展 pan/zoom，钳制保证填满） ─────────────────────────
interface CropOpts { zoom: number; offsetX: number; offsetY: number }
function getCoverPlacement(srcW: number, srcH: number, central: { x: number; y: number; w: number; h: number }, crop?: CropOpts | null) {
  if (srcW <= 0 || srcH <= 0 || central.w <= 0 || central.h <= 0) return null
  const zoom = Math.max(1, crop?.zoom ?? 1)
  const scale = Math.max(central.w / srcW, central.h / srcH) * zoom
  const drawW = srcW * scale
  const drawH = srcH * scale
  // 照片需覆盖 central：drawX ∈ [central.x+cw-drawW, central.x]
  // offX ∈ [0, maxOffX]，offset 0..1 映射；default 0.5 居中
  const maxOffX = Math.max(0, drawW - central.w)
  const maxOffY = Math.max(0, drawH - central.h)
  const offX = crop ? Math.max(0, Math.min(maxOffX, crop.offsetX * maxOffX)) : maxOffX / 2
  const offY = crop ? Math.max(0, Math.min(maxOffY, crop.offsetY * maxOffY)) : maxOffY / 2
  return { scale, drawX: central.x - offX, drawY: central.y - offY, drawW, drawH }
}

// ── 齿孔（圆角 + 浮雕渐变） ────────────────────────────────────────────────
function drawSprockets(ctx: SKRSContext2D, x: number, zoneY: number, stripW: number, opts: FrameOptions): void {
  const pitch = opts.sprocketPitch
  const holeW = opts.sprocketHoleW
  const holeH = Math.round(opts.sprocketH * TUNE_135.holeH)
  const holeY = zoneY + Math.round((opts.sprocketH - holeH) / 2)
  const holeR = Math.max(2, Math.round(holeW * 0.28))
  const margin = Math.round(opts.frameW * 0.04)
  const availableW = stripW - margin * 2
  const continuousHoleCount = Math.max(0, Math.floor((availableW - holeW) / pitch) + 1)
  const centeredHoleCount = Math.max(1, Math.round(stripW / pitch))
  const startX = x + (stripW - ((centeredHoleCount - 1) * pitch + holeW)) / 2
  const holeCount = centeredHoleCount
  for (let i = 0; i < holeCount; i++) {
    const hx = startX + i * pitch
    roundedRect(ctx, hx, holeY, holeW, holeH, holeR)
    ctx.fillStyle = '#f4eddf'
    ctx.fill()
    const inner = ctx.createLinearGradient(0, holeY, 0, holeY + holeH)
    inner.addColorStop(0, 'rgba(40, 30, 18, 0.4)')
    inner.addColorStop(0.35, 'rgba(40, 30, 18, 0)')
    inner.addColorStop(1, 'rgba(255, 255, 255, 0.25)')
    roundedRect(ctx, hx, holeY, holeW, holeH, holeR)
    ctx.fillStyle = inner
    ctx.fill()
  }
}

// ── 边字 ────────────────────────────────────────────────────────────────────
function edgeFont(opts: FrameOptions, scale = 1): { fontSize: number; font: string } {
  const regularSize = Math.max(11, Math.round(opts.textH * TUNE_135.fontSize))
  const fontSize = Math.max(7, Math.round(regularSize * scale))
  return { fontSize, font: `700 ${fontSize}px "Courier New", monospace` }
}

function edgeFont120(opts: FrameOptions, scale = 1): { fontSize: number; font: string } {
  const regularSize = Math.max(1, Math.round(opts.textH * TUNE_120.fontSize120))
  const fontSize = Math.max(1, Math.round(regularSize * scale))
  return { fontSize, font: `700 ${fontSize}px "Courier New", monospace` }
}

function setEdgeInk(ctx: SKRSContext2D, opts: FrameOptions): void {
  ctx.shadowColor = opts.stock.ink.glow
  ctx.shadowBlur = 3
  ctx.fillStyle = opts.stock.ink.color
}

function getEdgeMarkLayout(x: number, stripW: number, opts: FrameOptions) {
  const markPitch = opts.edgeMarkW + opts.edgeMarkGap
  const startX = x + opts.stripPadX
  return [{ x: startX, index: opts.frameNumber - 1 }].filter((m) => m.x < x + stripW)
}

function drawFrameNumberWithSuffix(ctx: SKRSContext2D, frameNumber: number, x: number, baseline: number, opts: FrameOptions): void {
  const digits = `${frameNumber}`
  const regularFont = edgeFont(opts).font
  ctx.font = regularFont
  ctx.fillText(digits, x, baseline)
  const digitWidth = ctx.measureText(digits).width
  ctx.font = edgeFont(opts, EDGE_NUMBER_SUFFIX_SCALE).font
  ctx.fillText('A', x + digitWidth, baseline)
  ctx.font = regularFont
}

function drawEdgeTextTop(ctx: SKRSContext2D, x: number, zoneY: number, stripW: number, opts: FrameOptions): void {
  if (!opts.stock.edgeText) return
  const { font } = opts.is120 ? edgeFont120(opts) : edgeFont(opts)
  const baseline = zoneY + Math.round(opts.textH * TUNE_135.textOffsetY)
  const presets = opts.is120 ? opts.stock.edgePresets120 : opts.stock.edgePresets
  const preset = presets[0 % presets.length]
  const marks = getEdgeMarkLayout(x, stripW, opts)
  ctx.save()
  ctx.font = font
  ctx.textBaseline = 'middle'
  setEdgeInk(ctx, opts)
  marks.forEach((mark, index) => {
    const label = index % 2 === 0 ? opts.stock.edgeText : preset
    ctx.fillText(label, mark.x, baseline, opts.edgeMarkW * 0.94)
  })
  ctx.restore()
}

function drawEdgeTextBottom(ctx: SKRSContext2D, x: number, zoneY: number, stripW: number, opts: FrameOptions): void {
  if (!opts.stock.edgeText) return
  const use120 = opts.is120
  const { fontSize, font } = use120 ? edgeFont120(opts) : edgeFont(opts)
  const baseline = zoneY + opts.textH - Math.round(opts.textH * TUNE_135.textOffsetY)
  const marks = getEdgeMarkLayout(x, stripW, opts)
  ctx.save()
  ctx.font = font
  ctx.textBaseline = 'middle'
  setEdgeInk(ctx, opts)
  marks.forEach((mark) => {
    const frameNumber = mark.index + 1
    ctx.fillText(`${frameNumber}`, mark.x + Math.round(opts.edgeMarkW * 0.03), baseline)
    if (opts.stock.frameNumberStyle === 'N/NA') {
      drawFrameNumberWithSuffix(ctx, frameNumber, mark.x + Math.round(opts.edgeMarkW * 0.52), baseline, opts)
    }
    // 条码竖条（deterministicNoise 模拟真实胶片条码）
    const barZoneX = mark.x + opts.edgeMarkW * 0.72
    const barZoneW = opts.edgeMarkW * 0.24
    const barH = Math.round(opts.textH * 0.55)
    const barY = baseline - Math.round(barH / 2)
    let bx = barZoneX
    for (let i = 0; i < 14 && bx < barZoneX + barZoneW; i++) {
      const seed = mark.index * 197 + i * 13
      const barW = Math.max(1, Math.round(fontSize * (0.05 + deterministicNoise(seed) * 0.1)))
      ctx.fillRect(Math.round(bx), barY, barW, barH)
      bx += barW + Math.max(1, Math.round(fontSize * (0.06 + deterministicNoise(seed + 7) * 0.12)))
    }
  })
  ctx.restore()
}

// ── 渲染入口 ────────────────────────────────────────────────────────────────
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

export async function renderFilmFrame(opts: RenderFilmFrameOptions): Promise<Buffer> {
  const { photoBuffer, photoW, photoH, formatId, stock, frameNo, crop, background, longEdge, outputFormat, quality } = opts
  const photo = await loadImage(photoBuffer)

  // 单帧几何：frameW = longEdge；none 也按 frameW 处理（无边框）
  const frameW = longEdge
  const useFormat: FilmFormatId = formatId === 'none' ? '135' : formatId
  const fopts = createOptions(useFormat, frameW, stock)
  fopts.frameNumber = Math.max(1, Math.floor(frameNo) || 1)
  if (formatId === 'none') {
    fopts.showSprockets = false
    fopts.showEdgeText = false
    fopts.bandH = 0
    fopts.textH = 0
    fopts.stripH = fopts.slotH
  }

  // 画布含阴影/padding：水平左右对称居中，垂直上方=阴影模糊余量、下方=模糊+向下偏移
  const shadowBlur = Math.round(fopts.frameW * 0.05)
  const shadowOffsetY = Math.round(fopts.frameW * 0.018)
  const strokePad = 2
  const shadowPad = shadowBlur * 2
  const left = shadowPad + strokePad
  const right = shadowPad + strokePad
  const top = shadowPad + strokePad
  const bottom = shadowPad + shadowOffsetY + strokePad
  const canvasW = Math.ceil(fopts.stripW + left + right)
  const canvasH = Math.ceil(fopts.stripH + top + bottom)

  const canvas = createCanvas(canvasW, canvasH)
  const ctx = canvas.getContext('2d')

  // 背景
  if (background.type === 'transparent') {
    ctx.clearRect(0, 0, canvasW, canvasH)
  } else if (background.type === 'solid') {
    ctx.fillStyle = background.color
    ctx.fillRect(0, 0, canvasW, canvasH)
  } else if (background.blurBuffer) {
    // 预模糊照片做背景
    const bgImg = await loadImage(background.blurBuffer)
    const scale = Math.max(canvasW / bgImg.width, canvasH / bgImg.height)
    const dw = bgImg.width * scale
    const dh = bgImg.height * scale
    ctx.drawImage(bgImg, (canvasW - dw) / 2, (canvasH - dh) / 2, dw, dh)
  }

  const x = left
  const y = top
  const frameX = x + fopts.stripPadX
  const frameY = y + fopts.bandH
  const central = { x: frameX, y: frameY, w: fopts.slotW, h: fopts.slotH }

  // 片基表面
  if (formatId !== 'none') {
    beginStripSurface(ctx, x, y, fopts.stripW, fopts.stripH, fopts)
  }

  // 照片 cover（pan/zoom 钳制填满）
  const placement = getCoverPlacement(photoW, photoH, central, crop)
  if (placement) {
    ctx.save()
    roundedRect(ctx, central.x, central.y, central.w, central.h, Math.max(2, Math.round(central.w * 0.008)))
    ctx.clip()
    ctx.fillStyle = '#1b1b1b'
    ctx.fillRect(central.x, central.y, central.w, central.h)
    ctx.drawImage(photo, placement.drawX, placement.drawY, placement.drawW, placement.drawH)
    ctx.restore()
  }

  // 齿孔
  if (fopts.showSprockets && formatId !== 'none') {
    const topZoneY = y + fopts.textH - fopts.textSprocketShift
    const bottomZoneY = y + fopts.stripH - fopts.textH - fopts.sprocketH + fopts.textSprocketShift
    drawSprockets(ctx, x, topZoneY, fopts.stripW, fopts)
    drawSprockets(ctx, x, bottomZoneY, fopts.stripW, fopts)
  }

  // 边字
  if (fopts.showEdgeText && formatId !== 'none') {
    drawEdgeTextTop(ctx, x, y, fopts.stripW, fopts)
    drawEdgeTextBottom(ctx, x, y + fopts.stripH - fopts.textH, fopts.stripW, fopts)
  }

  if (formatId !== 'none') {
    endStripSurface(ctx, x, y, fopts.stripW, fopts.stripH, fopts)
  }

  if (outputFormat === 'jpeg') {
    return canvas.toBuffer('image/jpeg', quality ?? 92)
  }
  return canvas.toBuffer('image/png')
}
