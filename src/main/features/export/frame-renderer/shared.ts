/**
 * 共享画布基元（移植自 film-frame-shared.js，MIT）。
 * 135/120 渲染器共用的纯绘制工具，不含画幅业务逻辑。
 * 仅 frame-renderer 子模块内部使用，不对外暴露。
 */
import type { Ctx, FrameOptions, Tune, Tune135 } from './types'

/** 读取 options.tune，缺省时回退到调用方给定的默认调参 */
export function resolveTune<T>(options: { tune?: T | undefined }, fallbackTune: T): T {
  return (options.tune as T) || fallbackTune
}

/** 圆角矩形路径 */
export function roundedRect(ctx: Ctx, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

/** 确定性噪声（条码用） */
export function deterministicNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** 片边字号核心 */
export function edgeFontSize(
  options: { textH: number },
  scale: number,
  tune: Tune | Tune135,
  sizeKey: 'fontSize' | 'fontSize120',
  minRegular: number,
  minScaled: number
): { fontSize: number; font: string } {
  const regularSize = Math.max(minRegular, Math.round(options.textH * (tune as unknown as Record<string, number>)[sizeKey]))
  const fontSize = Math.max(minScaled, Math.round(regularSize * scale))
  return { fontSize, font: `700 ${fontSize}px "Courier New", monospace` }
}

/** 设置边字墨色（发光 + 填充） */
export function setEdgeInk(ctx: Ctx, options: FrameOptions): void {
  ctx.shadowColor = options.stock.ink.glow
  ctx.shadowBlur = 3
  ctx.fillStyle = options.stock.ink.color
}

/** 条带底片圆角路径：120 幅面圆角更小，其余（含 135）走同一档 */
export function buildSingleStripPath(ctx: Ctx, x: number, y: number, stripW: number, stripH: number, options: FrameOptions): void {
  const radius = options.is120
    ? Math.max(2, Math.round(options.frameW * 0.004))
    : Math.max(6, Math.round(options.frameW * 0.015))
  roundedRect(ctx, x, y, stripW, stripH, radius)
}

type BuildPathFn = (ctx: Ctx, x: number, y: number, w: number, h: number) => void

/** 条带底面：投影底层 + 渐变基色 + 斜向光泽（fill 后保持 clip 打开） */
export function beginStripSurface(ctx: Ctx, x: number, y: number, stripW: number, stripH: number, options: FrameOptions, buildPath: BuildPathFn): void {
  ctx.save()
  ctx.shadowColor = 'rgba(25, 20, 12, 0.35)'
  ctx.shadowBlur = Math.round(options.frameW * 0.05)
  ctx.shadowOffsetY = Math.round(options.frameW * 0.018)
  buildPath(ctx, x, y, stripW, stripH)
  ctx.fillStyle = '#131110'
  ctx.fill()
  ctx.restore()

  ctx.save()
  buildPath(ctx, x, y, stripW, stripH)
  ctx.clip()
  const baseGradient = ctx.createLinearGradient(0, y, 0, y + stripH)
  baseGradient.addColorStop(0, '#231e19')
  baseGradient.addColorStop(0.12, '#161311')
  baseGradient.addColorStop(0.5, '#191512')
  baseGradient.addColorStop(0.88, '#151210')
  baseGradient.addColorStop(1, '#241f1a')
  ctx.fillStyle = baseGradient
  ctx.fillRect(x, y, stripW, stripH)
  const sheen = ctx.createLinearGradient(x, y, x + stripW * 0.55, y + stripH)
  sheen.addColorStop(0, 'rgba(255, 250, 235, 0.05)')
  sheen.addColorStop(0.35, 'rgba(255, 250, 235, 0)')
  sheen.addColorStop(0.8, 'rgba(255, 250, 235, 0.025)')
  sheen.addColorStop(1, 'rgba(255, 250, 235, 0)')
  ctx.fillStyle = sheen
  ctx.fillRect(x, y, stripW, stripH)
}

/** 条带收尾：闭合 beginStripSurface 的 save/clip，并描一圈高光描边 */
export function endStripSurface(ctx: Ctx, x: number, y: number, stripW: number, stripH: number, _options: FrameOptions, buildPath: BuildPathFn): void {
  ctx.restore()
  buildPath(ctx, x + 0.5, y + 0.5, stripW - 1, stripH - 1)
  ctx.strokeStyle = 'rgba(255, 248, 230, 0.07)'
  ctx.lineWidth = 1
  ctx.stroke()
}
