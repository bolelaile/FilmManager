/**
 * 135 画幅渲染器（移植自 film-frame-135.js，MIT）。
 * 物理常量、mm 几何、齿孔、边字（brand/preset 交替 + 帧号 + A + 条码）、照片 cover。
 * 仅 frame-renderer 子模块内部使用，不对外暴露。
 */
import type { Ctx, FrameOptions, FrameItem, ExposureGeometry, RowInfo, Tune, Tune135, RenderResult } from './types'
import { resolveTune, roundedRect, deterministicNoise, edgeFontSize, setEdgeInk, buildSingleStripPath, beginStripSurface, endStripSurface } from './shared'
import type { ResolvedStock } from '../stock-presets'

/** 135 物理常量（mm） */
export const FILM_135 = Object.freeze({
  filmHeightMm: 35,
  imageHeightMm: 24,
  standardImageWidthMm: 36,
  frameAdvanceMm: 38,
  sprocketPitchMm: 4.75,
  sprocketHoleWidthMm: 2.8,
})

/** 135 默认调参 */
export const DEFAULT_TUNE_135 = Object.freeze({
  sprocketH: 0.1,
  holeH: 0.76,
  holeW: 0.058,
  textH: 0.068,
  fontSize: 0.86,
  textOffsetY: 0.38,
  textSprocketGap: 0.022,
}) as Tune135

const EDGE_NUMBER_SUFFIX_SCALE = 0.68

const getTune = (options: FrameOptions): Tune135 => {
  const t = (options.tune as Tune135) || DEFAULT_TUNE_135
  return t
}

/** 曝光区几何（central + 可选 imageInSprockets/imageInEdgeText 扩展） */
export function getFrameExposureGeometry(x: number, y: number, options: FrameOptions): ExposureGeometry {
  const central = { x, y, w: options.slotW, h: options.slotH }
  const regions = [central]
  const edgeZoneH = Math.max(0, options.bandH - options.sprocketH)

  if (options.imageInSprockets) {
    regions.push(
      { x, y: y - options.sprocketH, w: options.slotW, h: options.sprocketH },
      { x, y: y + options.slotH, w: options.slotW, h: options.sprocketH },
    )
  }
  if (options.imageInEdgeText && edgeZoneH > 0) {
    regions.push(
      { x, y: y - options.bandH, w: options.slotW, h: edgeZoneH },
      { x, y: y + options.slotH + options.sprocketH, w: options.slotW, h: edgeZoneH },
    )
  }

  const top = Math.min(...regions.map((region) => region.y))
  const bottom = Math.max(...regions.map((region) => region.y + region.h))
  return {
    central,
    regions,
    bounds: { x, y: top, w: options.slotW, h: bottom - top },
    continuous: Boolean(options.imageInSprockets),
  }
}

/** 构建曝光区裁切路径 */
function addExposurePath(ctx: Ctx, geometry: ExposureGeometry, radius: number): void {
  ctx.beginPath()
  if (geometry.continuous) {
    ctx.rect(geometry.bounds.x, geometry.bounds.y, geometry.bounds.w, geometry.bounds.h)
    return
  }
  geometry.regions.forEach((region, index) => {
    if (index === 0) {
      const r = Math.min(radius, region.w / 2, region.h / 2)
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(region.x, region.y, region.w, region.h, r)
      } else {
        ctx.moveTo(region.x + r, region.y)
        ctx.arcTo(region.x + region.w, region.y, region.x + region.w, region.y + region.h, r)
        ctx.arcTo(region.x + region.w, region.y + region.h, region.x, region.y + region.h, r)
        ctx.arcTo(region.x, region.y + region.h, region.x, region.y, r)
        ctx.arcTo(region.x, region.y, region.x + region.w, region.y, r)
        ctx.closePath()
      }
    } else {
      ctx.rect(region.x, region.y, region.w, region.h)
    }
  })
}

/** cover 放置（居中填满） */
export function getCoverPlacement(sourceWidth: number, sourceHeight: number, central: { w: number; h: number; x: number; y: number } | null) {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0 || !central || central.w <= 0 || central.h <= 0) {
    return null
  }
  const scale = Math.max(central.w / sourceWidth, central.h / sourceHeight)
  const drawW = sourceWidth * scale
  const drawH = sourceHeight * scale
  return { scale, drawX: central.x + (central.w - drawW) / 2, drawY: central.y + (central.h - drawH) / 2, drawW, drawH }
}

/** 绘制照片帧（cover 裁切填满曝光区） */
export function drawFrame(ctx: Ctx, item: FrameItem, x: number, y: number, options: FrameOptions, drawState: { dragAlpha?: number } = {}): ExposureGeometry {
  const geometry = getFrameExposureGeometry(x, y, options)
  const { central } = geometry
  const placement = getCoverPlacement(item.width, item.height, central)
  if (!placement) return geometry
  const { drawX, drawY, drawW, drawH } = placement
  const radius = Math.max(2, Math.round(central.w * 0.008))

  ctx.save()
  addExposurePath(ctx, geometry, radius)
  ctx.clip()
  ctx.fillStyle = '#1b1b1b'
  ctx.fillRect(geometry.bounds.x, geometry.bounds.y, geometry.bounds.w, geometry.bounds.h)
  ctx.globalAlpha = drawState.dragAlpha ?? 1
  ctx.drawImage(item.source, drawX, drawY, drawW, drawH)
  ctx.globalAlpha = 1
  ctx.restore()

  if (!geometry.continuous) {
    roundedRect(ctx, central.x + 0.5, central.y + 0.5, central.w - 1, central.h - 1, radius)
    ctx.strokeStyle = 'rgba(255, 214, 150, 0.1)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  return geometry
}

/** 齿孔（圆角 + 浮雕渐变，支持 continuous/center/anchored 对齐） */
export function drawSprockets(
  ctx: Ctx, x: number, zoneY: number, stripW: number, options: FrameOptions,
  _leaderFootX: number | null = null, alignment: 'continuous' | 'center' | 'anchored' = 'continuous',
  _alignmentOriginX: number | null = null
): void {
  const tune = getTune(options)
  const pitch = options.sprocketPitch
  const holeW = options.sprocketHoleW
  const holeH = Math.round(options.sprocketH * tune.holeH)
  const holeY = zoneY + Math.round((options.sprocketH - holeH) / 2)
  const holeR = Math.max(2, Math.round(holeW * 0.28))
  const margin = Math.round(options.frameW * 0.04)
  const availableW = stripW - margin * 2
  const continuousHoleCount = Math.max(0, Math.floor((availableW - holeW) / pitch) + 1)
  const centeredHoleCount = Math.max(1, Math.round(stripW / pitch))
  const startX = alignment === 'center'
    ? x + (stripW - ((centeredHoleCount - 1) * pitch + holeW)) / 2
    : x + margin
  const holeCount = alignment === 'center' ? centeredHoleCount : continuousHoleCount

  for (let index = 0; index < holeCount; index += 1) {
    const hx = startX + index * pitch
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

function edgeFont(options: FrameOptions, scale = 1) {
  return edgeFontSize(options, scale, getTune(options), 'fontSize', 11, 7)
}

function getEdgeMarkLayout(x: number, stripW: number, rowInfo: RowInfo, options: FrameOptions) {
  const markPitch = options.edgeMarkW + options.edgeMarkGap
  const startX = x + options.stripPadX + (rowInfo.leader ? options.leaderAdvance : 0)
  const firstIndex = Number.isFinite(rowInfo.edgeMarkStartIndex)
    ? Math.max(0, Math.floor(rowInfo.edgeMarkStartIndex!))
    : Math.floor((rowInfo.start * (options.slotW + options.slotGap)) / markPitch)
  const marks: { x: number; index: number }[] = []
  for (let markX = startX, index = firstIndex; markX < x + stripW; markX += markPitch, index += 1) {
    marks.push({ x: markX, index })
  }
  return marks
}

function drawFrameNumberWithSuffix(ctx: Ctx, frameNumber: number, x: number, baseline: number, options: FrameOptions): void {
  const digits = `${frameNumber}`
  const regularFont = edgeFont(options).font
  ctx.font = regularFont
  ctx.fillText(digits, x, baseline)
  const digitWidth = ctx.measureText(digits).width
  ctx.font = edgeFont(options, EDGE_NUMBER_SUFFIX_SCALE).font
  ctx.fillText('A', x + digitWidth, baseline)
  ctx.font = regularFont
}

/** 顶边字（brand / preset 交替） */
export function drawEdgeTextTop(ctx: Ctx, x: number, zoneY: number, stripW: number, rowInfo: RowInfo, rowIndex: number, options: FrameOptions): void {
  if (!options.stock.edgeText) return
  const tune = getTune(options)
  const { font } = edgeFont(options)
  const baseline = zoneY + Math.round(options.textH * tune.textOffsetY)
  const presets = options.stock.edgePresets
  const preset = presets[rowIndex % presets.length]
  const marks = getEdgeMarkLayout(x, stripW, rowInfo, options)

  ctx.save()
  ctx.font = font
  ctx.textBaseline = 'middle'
  setEdgeInk(ctx, options)
  marks.forEach((mark, index) => {
    const label = index % 2 === 0 ? options.stock.edgeText : preset
    ctx.fillText(label, mark.x, baseline, options.edgeMarkW * 0.94)
  })
  ctx.restore()
}

/** 底边字（帧号 + A 后缀 + 条码竖条） */
export function drawEdgeTextBottom(ctx: Ctx, x: number, zoneY: number, stripW: number, rowInfo: RowInfo, options: FrameOptions): void {
  if (!options.stock.edgeText) return
  const tune = getTune(options)
  const { fontSize, font } = edgeFont(options)
  const baseline = zoneY + options.textH - Math.round(options.textH * tune.textOffsetY)
  const marks = getEdgeMarkLayout(x, stripW, rowInfo, options)

  ctx.save()
  ctx.font = font
  ctx.textBaseline = 'middle'
  setEdgeInk(ctx, options)
  marks.forEach((mark) => {
    const frameNumber = mark.index + 1
    ctx.fillText(`${frameNumber}`, mark.x + Math.round(options.edgeMarkW * 0.03), baseline)
    if (options.stock.frameNumberStyle === 'N/NA') {
      drawFrameNumberWithSuffix(ctx, frameNumber, mark.x + Math.round(options.edgeMarkW * 0.52), baseline, options)
    }
    ctx.fillRect(
      mark.x + options.edgeMarkW - Math.round(fontSize * 0.45),
      baseline - Math.round(fontSize * 0.16),
      Math.round(fontSize * 0.32),
      Math.round(fontSize * 0.32),
    )
  })
  ctx.restore()
}

/** 创建 135 单帧选项（mm 几何） */
export function createSingleFrame135Options(params: {
  frameW: number
  stock: ResolvedStock
  frameNumber?: number
  showEdgeText?: boolean
  showSprockets?: boolean
  tune?: Tune135
  edgeMarkStartIndex?: number | null
}): FrameOptions {
  const { frameW, stock, frameNumber = 1, showEdgeText = true, showSprockets = true, tune = DEFAULT_TUNE_135, edgeMarkStartIndex = null } = params
  const baseFrameW = frameW
  const slotW = baseFrameW
  const slotH = Math.round(baseFrameW / 1.5)
  const pxPerMm135 = baseFrameW / FILM_135.standardImageWidthMm
  const minimumBandH = Math.round(pxPerMm135 * (FILM_135.filmHeightMm - FILM_135.imageHeightMm) / 2)
  const textH = Math.round(baseFrameW * tune.textH)
  const sprocketH = Math.round(baseFrameW * tune.sprocketH)
  const textSprocketShift = Math.min(Math.round(baseFrameW * tune.textSprocketGap), textH)
  const bandH = Math.max(sprocketH + textH - textSprocketShift, minimumBandH)
  const slotGap = Math.max(0, pxPerMm135 * FILM_135.frameAdvanceMm - baseFrameW)
  const stripPadX = slotGap / 2
  const stripW = slotW + slotGap
  const stripH = slotH + bandH * 2
  return {
    frameW: baseFrameW, frameH: slotH, baseFrameW, baseFrameH: slotH,
    slotW, slotH, slotGap, bandH, sprocketH, textH, textSprocketShift,
    sprocketPitch: pxPerMm135 * FILM_135.sprocketPitchMm,
    sprocketHoleW: Math.round(baseFrameW * tune.holeW),
    stripPadX, edgeMarkW: baseFrameW, edgeMarkGap: slotGap, edgeMarkSlotSpan: 1,
    leaderAdvance: baseFrameW + slotGap,
    showEdgeText: showEdgeText && Boolean(stock.edgeText), showSprockets,
    imageInSprockets: false, imageInEdgeText: false,
    is120: false, isHalfFrame: false, isCroppedHalfFrame: false, isWide135: false,
    stock, frameNumber: Math.max(1, Math.floor(frameNumber) || 1),
    edgeMarkStartIndex: Number.isFinite(edgeMarkStartIndex as number) ? Math.max(0, Math.floor(edgeMarkStartIndex!)) : null,
    tune: tune as unknown as Tune, stripW, stripH,
  }
}

/** 渲染 135 单帧 */
export function renderSingleFrame135(ctx: Ctx, item: FrameItem, options: FrameOptions, origin: { x?: number; y?: number } = {}): RenderResult {
  const x = origin.x ?? -options.stripW / 2
  const y = origin.y ?? -options.stripH / 2
  const frameX = x + options.stripPadX
  const frameY = y + options.bandH
  const rowInfo: RowInfo = {
    start: options.edgeMarkStartIndex ?? options.frameNumber - 1,
    count: 1, capacity: 1, leader: false, trailer: false, trimmed: false,
    edgeMarkStartIndex: options.edgeMarkStartIndex,
  }
  const buildPath = (context: Ctx, px: number, py: number, width: number, height: number) => buildSingleStripPath(context, px, py, width, height, options)

  beginStripSurface(ctx, x, y, options.stripW, options.stripH, options, buildPath)
  const geometry = drawFrame(ctx, item, frameX, frameY, options)
  if (options.showSprockets) {
    const topZoneY = y + options.textH - options.textSprocketShift
    const bottomZoneY = y + options.stripH - options.textH - options.sprocketH + options.textSprocketShift
    drawSprockets(ctx, x, topZoneY, options.stripW, options, null, 'center')
    drawSprockets(ctx, x, bottomZoneY, options.stripW, options, null, 'center')
  }
  if (options.showEdgeText) {
    drawEdgeTextTop(ctx, x, y, options.stripW, rowInfo, 0, options)
    drawEdgeTextBottom(ctx, x, y + options.stripH - options.textH, options.stripW, rowInfo, options)
  }
  endStripSurface(ctx, x, y, options.stripW, options.stripH, options, buildPath)
  return { frameGeometry: geometry, stripBounds: { x, y, w: options.stripW, h: options.stripH } }
}
