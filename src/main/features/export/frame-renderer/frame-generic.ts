/**
 * 通用画幅渲染器（移植自 film-frame.js，MIT）。
 * 10 画幅定义、135 系列（半格/Xpan/超宽）与 120 系列渲染、120 边字（三角箭头+条码+preset 交替）。
 * 仅 frame-renderer 子模块内部使用，不对外暴露。
 */
import type { Ctx, FrameOptions, FrameItem, FormatDef, InputAdapter, RowInfo, Tune, RenderResult, RenderBounds } from './types'
import { resolveTune, deterministicNoise, edgeFontSize, setEdgeInk, buildSingleStripPath, beginStripSurface, endStripSurface } from './shared'
import { FILM_135, DEFAULT_TUNE_135, drawFrame, drawSprockets, drawEdgeTextTop, drawEdgeTextBottom, renderSingleFrame135, createSingleFrame135Options } from './frame-135'
import type { ResolvedStock } from '../stock-presets'

/** 画幅定义 */
export const FORMAT_DEFINITIONS: Record<string, FormatDef> = {
  '135': { id: '135', family: '135', ratio: 36 / 24, imageWidthMm: 36, imageHeightMm: 24, label: '135 全画幅', sizeLabel: '36 × 24 mm' },
  'half': { id: 'half', family: '135', ratio: 18 / 24, imageWidthMm: 18, imageHeightMm: 24, half: true, label: '135 半格', sizeLabel: '18 × 24 mm' },
  'xpan': { id: 'xpan', family: '135', ratio: 65 / 24, imageWidthMm: 65, imageHeightMm: 24, wide: true, label: 'XPan 宽幅', sizeLabel: '65 × 24 mm' },
  '135-69': { id: '135-69', family: '135', ratio: 84 / 24, imageWidthMm: 84, imageHeightMm: 24, wide: true, label: '135 超宽幅', sizeLabel: '84 × 24 mm' },
  '645': { id: '645', family: '120', ratio: 41.5 / 56, imageWidthMm: 41.5, imageHeightMm: 56, columns: 4, portrait: true, label: '120 · 645', sizeLabel: '41.5 × 56 mm' },
  '66': { id: '66', family: '120', ratio: 1, imageWidthMm: 56, imageHeightMm: 56, columns: 3, label: '120 · 6×6', sizeLabel: '56 × 56 mm' },
  '67': { id: '67', family: '120', ratio: 69.5 / 56, imageWidthMm: 69.5, imageHeightMm: 56, columns: 2, label: '120 · 6×7', sizeLabel: '69.5 × 56 mm' },
  '69': { id: '69', family: '120', ratio: 84 / 56, imageWidthMm: 84, imageHeightMm: 56, columns: 2, label: '120 · 6×9', sizeLabel: '84 × 56 mm' },
  '612': { id: '612', family: '120', ratio: 112 / 56, imageWidthMm: 112, imageHeightMm: 56, columns: 3, label: '120 · 6×12', sizeLabel: '112 × 56 mm' },
  '617': { id: '617', family: '120', ratio: 168 / 56, imageWidthMm: 168, imageHeightMm: 56, columns: 2, label: '120 · 6×17', sizeLabel: '168 × 56 mm' },
}

/** 默认调参（135 基础 + 120 扩展） */
export const DEFAULT_TUNE = Object.freeze({
  ...DEFAULT_TUNE_135,
  fontSize120: 0.74,
  textSprocketGap120: 0.015,
  band120: 0.044,
  gap120: 0.085,
}) as Tune

function getFormat(formatId: string): FormatDef {
  return FORMAT_DEFINITIONS[formatId] || FORMAT_DEFINITIONS['135']
}

function getInputAdapter(formatId: string, inputMode = 'cropped'): InputAdapter {
  const format = getFormat(formatId)
  if (format.id !== 'half') {
    return { id: 'default', slotRatio: format.ratio, targetPortrait: Boolean(format.portrait), split: 'none', sourceMeaning: '每个文件对应一个画幅。', edgeMarkSlotSpan: 1 }
  }
  if (inputMode === 'uncropped') {
    return { id: 'uncropped', slotRatio: FORMAT_DEFINITIONS['135'].ratio, targetPortrait: false, split: 'none', sourceMeaning: '每个文件作为一张完整 3:2 扫描图显示，不会自动拆分为两格。', edgeMarkSlotSpan: 1 }
  }
  return { id: 'cropped', slotRatio: format.ratio, targetPortrait: true, split: 'none', sourceMeaning: '每个文件对应一格 18 × 24 mm 半格画面。', edgeMarkSlotSpan: 2 }
}

const getTune = (options: FrameOptions): Tune => resolveTune(options, DEFAULT_TUNE) as Tune

function edgeFont120(options: FrameOptions, scale = 1) {
  return edgeFontSize(options, scale, getTune(options), 'fontSize120', 1, 1)
}

function getEdgeMarkLayout120(x: number, stripW: number, rowInfo: RowInfo, options: FrameOptions) {
  const markPitch = options.edgeMarkW + options.edgeMarkGap
  const startX = x + options.stripPadX
  const markCount = Math.ceil(rowInfo.capacity / options.edgeMarkSlotSpan)
  return Array.from({ length: markCount }, (_, mark) => ({
    x: startX + mark * markPitch,
    index: Math.floor(rowInfo.start / options.edgeMarkSlotSpan) + mark,
  })).filter((mark) => mark.x < x + stripW)
}

/** 120 顶边字（品牌全名 + 帧号 + 品牌缩写） */
function drawEdgeTextTop120(ctx: Ctx, x: number, zoneY: number, stripW: number, rowInfo: RowInfo, options: FrameOptions): void {
  if (!options.stock.edgeText) return
  const { font } = edgeFont120(options)
  const numberFont = edgeFont120(options, 1.15).font
  const baseline = zoneY + Math.round(options.textH * 0.52)
  const brand = options.stock.edgeText.split(' ')[0] || ''
  const marks = getEdgeMarkLayout120(x, stripW, rowInfo, options)

  ctx.save()
  ctx.textBaseline = 'middle'
  setEdgeInk(ctx, options)
  marks.forEach((mark) => {
    ctx.font = font
    ctx.textAlign = 'left'
    ctx.fillText(options.stock.edgeText, mark.x + Math.round(options.edgeMarkW * 0.02), baseline, options.edgeMarkW * 0.6)
    ctx.font = numberFont
    ctx.fillText(`${mark.index + 1}`, mark.x + Math.round(options.edgeMarkW * 0.7), baseline)
    if (brand) {
      ctx.font = font
      ctx.textAlign = 'right'
      ctx.fillText(brand, mark.x + options.edgeMarkW, baseline, options.edgeMarkW * 0.22)
    }
  })
  ctx.restore()
}

/** 120 底边字（三角箭头 + 帧号 + preset 交替 + 条码竖条） */
function drawEdgeTextBottom120(ctx: Ctx, x: number, zoneY: number, stripW: number, rowInfo: RowInfo, rowIndex: number, options: FrameOptions): void {
  if (!options.stock.edgeText) return
  const { fontSize, font } = edgeFont120(options)
  const baseline = zoneY + Math.round(options.textH * 0.52)
  const presets = options.stock.edgePresets120?.length ? options.stock.edgePresets120 : ['120', 'SAFETY FILM']
  const preset = presets[rowIndex % presets.length]
  const marks = getEdgeMarkLayout120(x, stripW, rowInfo, options)

  ctx.save()
  ctx.font = font
  ctx.textBaseline = 'middle'
  setEdgeInk(ctx, options)
  marks.forEach((mark, index) => {
    const triW = Math.round(fontSize * 0.55)
    const triH = Math.round(fontSize * 0.5)
    const triX = mark.x + Math.round(options.edgeMarkW * 0.03)
    ctx.beginPath()
    ctx.moveTo(triX, baseline - triH / 2)
    ctx.lineTo(triX + triW, baseline)
    ctx.lineTo(triX, baseline + triH / 2)
    ctx.closePath()
    ctx.fill()
    ctx.textAlign = 'left'
    ctx.fillText(`${mark.index + 1}`, triX + triW + Math.round(fontSize * 0.3), baseline)
    if (index % 2 === 1) {
      ctx.fillText(preset, mark.x + Math.round(options.edgeMarkW * 0.34), baseline, options.edgeMarkW * 0.32)
    }
    const barZoneX = mark.x + options.edgeMarkW * 0.72
    const barZoneW = options.edgeMarkW * 0.24
    const barH = Math.round(options.textH * 0.55)
    const barY = baseline - Math.round(barH / 2)
    let bx = barZoneX
    for (let i = 0; i < 14 && bx < barZoneX + barZoneW; i += 1) {
      const seed = mark.index * 197 + i * 13
      const barW = Math.max(1, Math.round(fontSize * (0.05 + deterministicNoise(seed) * 0.1)))
      ctx.fillRect(Math.round(bx), barY, barW, barH)
      bx += barW + Math.max(1, Math.round(fontSize * (0.06 + deterministicNoise(seed + 7) * 0.12)))
    }
  })
  ctx.restore()
}

/** 135 系列（半格/Xpan/超宽）选项 */
function createSingleFrame135FamilyOptions(settings: CreateFrameSettings, format: FormatDef, inputAdapter: InputAdapter): FrameOptions {
  const tune = settings.tune || DEFAULT_TUNE
  const frameNumber = Math.max(1, Math.floor(settings.frameNumber ?? 1))
  const edgeMarkStartIndex = typeof settings.edgeMarkStartIndex === 'number' ? Math.max(0, Math.floor(settings.edgeMarkStartIndex)) : null
  const effectiveFormat = format.id === 'half' && inputAdapter.id === 'uncropped' ? FORMAT_DEFINITIONS['135'] : format
  const slotW = settings.frameW
  const pxPerMm = slotW / effectiveFormat.imageWidthMm
  const slotH = pxPerMm * effectiveFormat.imageHeightMm
  const frameAdvanceMm = format.id === 'half' && inputAdapter.id === 'cropped' ? FILM_135.frameAdvanceMm / 2 : effectiveFormat.imageWidthMm + 2
  const slotGap = Math.max(0, pxPerMm * frameAdvanceMm - slotW)
  const textH = Math.round(pxPerMm * FILM_135.standardImageWidthMm * tune.textH)
  const sprocketH = Math.round(pxPerMm * FILM_135.standardImageWidthMm * tune.sprocketH)
  const textSprocketShift = Math.min(Math.round(pxPerMm * FILM_135.standardImageWidthMm * tune.textSprocketGap), textH)
  const minimumBandH = Math.round(pxPerMm * (FILM_135.filmHeightMm - FILM_135.imageHeightMm) / 2)
  const bandH = Math.max(sprocketH + textH - textSprocketShift, minimumBandH)
  const stripPadX = slotGap / 2
  return {
    frameW: slotW, frameH: slotH, baseFrameW: pxPerMm * FILM_135.standardImageWidthMm, baseFrameH: pxPerMm * FILM_135.imageHeightMm,
    slotW, slotH, slotGap, bandH, sprocketH, textH, textSprocketShift,
    sprocketPitch: pxPerMm * FILM_135.sprocketPitchMm, sprocketHoleW: pxPerMm * FILM_135.sprocketHoleWidthMm,
    stripPadX, edgeMarkW: pxPerMm * FILM_135.standardImageWidthMm, edgeMarkGap: pxPerMm * (FILM_135.frameAdvanceMm - FILM_135.standardImageWidthMm),
    edgeMarkSlotSpan: inputAdapter.edgeMarkSlotSpan, leaderAdvance: pxPerMm * FILM_135.frameAdvanceMm,
    showEdgeText: settings.showEdgeText !== false && Boolean(settings.stock.edgeText), showSprockets: settings.showSprockets !== false,
    imageInSprockets: Boolean(settings.imageInSprockets), imageInEdgeText: Boolean(settings.imageInEdgeText),
    is120: false, isHalfFrame: format.id === 'half', isCroppedHalfFrame: format.id === 'half' && inputAdapter.id === 'cropped',
    isWide135: Boolean(format.wide), stock: settings.stock,
    frameNumber,
    edgeMarkStartIndex,
    tune, stripW: slotW + slotGap, stripH: slotH + bandH * 2, format, inputAdapter, renderer: 'generic',
  }
}

/** 120 系列选项 */
function createSingleFrame120Options(settings: CreateFrameSettings, format: FormatDef, inputAdapter: InputAdapter): FrameOptions {
  const tune = settings.tune || DEFAULT_TUNE
  const slotW = settings.frameW
  const slotH = slotW / format.ratio
  const textH = Math.round(slotH * tune.band120)
  const requestedSprockets = settings.showSprockets === true && Boolean((settings.stock as ResolvedStock & { sprocketsIn120?: boolean }).sprocketsIn120)
  const sprocketH = requestedSprockets ? Math.round(slotH * 0.09) : 0
  const textSprocketShift = requestedSprockets ? Math.min(Math.round(slotH * tune.textSprocketGap120), textH) : 0
  const bandH = Math.max(sprocketH + textH - textSprocketShift, Math.round(slotH * 0.02))
  const stripPadX = Math.round(slotH * 0.05)
  const slotGap = Math.round(slotH * tune.gap120)
  return {
    frameW: slotW, frameH: slotH, baseFrameW: slotW, baseFrameH: slotH,
    slotW, slotH, slotGap, bandH, sprocketH, textH, textSprocketShift,
    sprocketPitch: slotH * (4.75 / 56), sprocketHoleW: slotH * (2.8 / 56),
    stripPadX, edgeMarkW: slotW, edgeMarkGap: slotGap, edgeMarkSlotSpan: 1, leaderAdvance: slotW + slotGap,
    showEdgeText: settings.showEdgeText !== false && Boolean(settings.stock.edgeText), showSprockets: requestedSprockets,
    imageInSprockets: false, imageInEdgeText: false,
    is120: true, isHalfFrame: false, isCroppedHalfFrame: false, isWide135: false,
    stock: settings.stock, frameNumber: Math.max(1, Math.floor(settings.frameNumber ?? 1)),
    edgeMarkStartIndex: typeof settings.edgeMarkStartIndex === "number" ? Math.max(0, Math.floor(settings.edgeMarkStartIndex)) : null,
    tune, stripW: slotW + stripPadX * 2, stripH: slotH + bandH * 2, format, inputAdapter, renderer: 'generic',
  }
}

interface CreateFrameSettings {
  frameW: number
  stock: ResolvedStock
  frameNumber?: number
  showEdgeText?: boolean
  showSprockets?: boolean
  imageInSprockets?: boolean
  imageInEdgeText?: boolean
  tune?: Tune
  edgeMarkStartIndex?: number | null
}

/** 创建单帧选项（按画幅分发） */
export function createSingleFrameOptions(params: {
  formatId?: string
  inputMode?: string
  frameW: number
  stock: ResolvedStock
  frameNumber?: number
  showEdgeText?: boolean
  showSprockets?: boolean
  imageInSprockets?: boolean
  imageInEdgeText?: boolean
  tune?: Tune
  edgeMarkStartIndex?: number | null
}): FrameOptions & { format: FormatDef; inputAdapter: InputAdapter; renderer: string } {
  const { formatId = '135', inputMode = 'cropped', frameW, stock, frameNumber = 1, showEdgeText = true, showSprockets, imageInSprockets = false, imageInEdgeText = false, tune = DEFAULT_TUNE, edgeMarkStartIndex = null } = params
  const format = getFormat(formatId)
  const inputAdapter = getInputAdapter(format.id, inputMode)
  const settings: CreateFrameSettings = { frameW, stock, frameNumber, showEdgeText, showSprockets, imageInSprockets, imageInEdgeText, tune, edgeMarkStartIndex }
  if (format.id === '135' || (format.id === 'half' && inputAdapter.id === 'uncropped')) {
    return { ...createSingleFrame135Options(settings), format, inputAdapter, renderer: '135' }
  }
  if (format.family === '120') {
    return { ...createSingleFrame120Options(settings, format, inputAdapter), format, inputAdapter, renderer: 'generic' }
  }
  return { ...createSingleFrame135FamilyOptions(settings, format, inputAdapter), format, inputAdapter, renderer: 'generic' }
}

/** 渲染通用单帧（半格/Xpan/120 系列） */
function renderGenericSingleFrame(ctx: Ctx, item: FrameItem, options: FrameOptions, origin: { x?: number; y?: number } = {}): RenderResult {
  const x = origin.x ?? -options.stripW / 2
  const y = origin.y ?? -options.stripH / 2
  const frameX = x + options.stripPadX
  const frameY = y + options.bandH
  const rowInfo: RowInfo = {
    start: options.edgeMarkStartIndex ?? (options.isCroppedHalfFrame ? (options.frameNumber - 1) * options.edgeMarkSlotSpan : options.frameNumber - 1),
    count: 1, capacity: 1, leader: false, trailer: false, trimmed: false, edgeMarkStartIndex: options.edgeMarkStartIndex,
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
    if (options.is120) {
      drawEdgeTextTop120(ctx, x, y, options.stripW, rowInfo, options)
      drawEdgeTextBottom120(ctx, x, y + options.stripH - options.textH, options.stripW, rowInfo, 0, options)
    } else {
      drawEdgeTextTop(ctx, x, y, options.stripW, rowInfo, 0, options)
      drawEdgeTextBottom(ctx, x, y + options.stripH - options.textH, options.stripW, rowInfo, options)
    }
  }
  endStripSurface(ctx, x, y, options.stripW, options.stripH, options, buildPath)
  return { frameGeometry: geometry, stripBounds: { x, y, w: options.stripW, h: options.stripH }, format: options.format, inputAdapter: options.inputAdapter }
}

/** 渲染单帧（按 renderer 分发） */
export function renderSingleFrame(ctx: Ctx, item: FrameItem, options: FrameOptions, origin: { x?: number; y?: number } = {}): RenderResult {
  if (options.renderer === '135') {
    const result = renderSingleFrame135(ctx, item, options, origin)
    return { ...result, format: options.format, inputAdapter: options.inputAdapter }
  }
  return renderGenericSingleFrame(ctx, item, options, origin)
}

/** 渲染边界（含投影 padding） */
export function getSingleFrameRenderBounds(options: FrameOptions, includeShadow = true): RenderBounds {
  const shadowBlur = includeShadow ? Math.round(options.frameW * 0.05) : 0
  const shadowOffsetY = includeShadow ? Math.round(options.frameW * 0.018) : 0
  const strokePad = 2
  const shadowPad = shadowBlur * 2
  const left = shadowPad + strokePad
  const right = shadowPad + strokePad
  const top = shadowPad + strokePad
  const bottom = shadowPad + Math.max(0, shadowOffsetY) + strokePad
  return {
    width: Math.ceil(options.stripW + left + right),
    height: Math.ceil(options.stripH + top + bottom),
    originX: left, originY: top,
    padding: { left, right, top, bottom },
    stripBounds: { x: left, y: top, w: options.stripW, h: options.stripH },
  }
}
