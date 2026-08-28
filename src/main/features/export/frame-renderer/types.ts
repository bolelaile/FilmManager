/**
 * 胶片帧渲染器内部类型（移植自参考项目 film-index-generator，MIT）。
 * 仅 frame-renderer 子模块内部使用，不对外暴露。
 */
import type { SKRSContext2D, Canvas, Image } from '@napi-rs/canvas'
import type { ResolvedStock } from '../stock-presets'

export type Ctx = SKRSContext2D

/** 画幅定义 */
export interface FormatDef {
  id: string
  family: '135' | '120'
  ratio: number
  imageWidthMm: number
  imageHeightMm: number
  half?: boolean
  wide?: boolean
  portrait?: boolean
  columns?: number
  label?: string
  sizeLabel?: string
}

/** 输入适配器（半格裁切模式等） */
export interface InputAdapter {
  id: string
  slotRatio: number
  targetPortrait: boolean
  split: string
  sourceMeaning: string
  edgeMarkSlotSpan: number
}

/** 135 调参 */
export interface Tune135 {
  sprocketH: number
  holeH: number
  holeW: number
  textH: number
  fontSize: number
  textOffsetY: number
  textSprocketGap: number
}

/** 完整调参（含 120 扩展） */
export interface Tune extends Tune135 {
  fontSize120: number
  textSprocketGap120: number
  band120: number
  gap120: number
}

/** 帧渲染选项（由 createSingleFrameOptions 计算） */
export interface FrameOptions {
  frameW: number
  frameH: number
  baseFrameW: number
  baseFrameH: number
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
  edgeMarkSlotSpan: number
  leaderAdvance: number
  showEdgeText: boolean
  showSprockets: boolean
  imageInSprockets: boolean
  imageInEdgeText: boolean
  is120: boolean
  isHalfFrame: boolean
  isCroppedHalfFrame: boolean
  isWide135: boolean
  stock: ResolvedStock
  frameNumber: number
  edgeMarkStartIndex: number | null
  tune: Tune
  stripW: number
  stripH: number
  format?: FormatDef
  inputAdapter?: InputAdapter
  renderer?: string
}

/** 行信息（边字布局用） */
export interface RowInfo {
  start: number
  count: number
  capacity: number
  leader: boolean
  trailer: boolean
  trimmed: boolean
  edgeMarkStartIndex: number | null
}

/** 照片项（传给 drawFrame） */
export interface FrameItem {
  source: Canvas | Image
  width: number
  height: number
}

/** 曝光区几何 */
export interface ExposureGeometry {
  central: { x: number; y: number; w: number; h: number }
  regions: { x: number; y: number; w: number; h: number }[]
  bounds: { x: number; y: number; w: number; h: number }
  continuous: boolean
}

/** 渲染结果 */
export interface RenderResult {
  frameGeometry: ExposureGeometry
  stripBounds: { x: number; y: number; w: number; h: number }
  format?: FormatDef
  inputAdapter?: InputAdapter
}

/** 渲染边界（含投影 padding） */
export interface RenderBounds {
  width: number
  height: number
  originX: number
  originY: number
  padding: { left: number; right: number; top: number; bottom: number }
  stripBounds: { x: number; y: number; w: number; h: number }
}
