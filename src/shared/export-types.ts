// 导出功能共享类型（main / renderer 共用）
// 对齐参考项目 film-index-generator：Canvas 渲染，仅 PNG/JPEG 输出，物理 mm 几何 + 数据驱动边字。

export type FilmFormatId =
  | '135' // 135 全画幅 36×24
  | 'half' // 135 半格 18×24（竖向）
  | 'xpan' // 135 宽幅 XPan 65×24
  | '645' // 120 · 645
  | '66' // 120 · 6×6
  | '67' // 120 · 6×7
  | '69' // 120 · 6×9
  | '612' // 120 · 6×12
  | '617' // 120 · 6×17
  | 'none' // 无边框

export type EdgePosition = 'top' | 'bottom' | 'left' | 'right'

export interface EdgeTextConfig {
  enabled: boolean
  /** 'auto' = 按胶卷品牌自动匹配 stock 边字内容/墨色；具体 stockId 覆盖 */
  stockId: 'auto' | string
  positions: EdgePosition[]
  /** 每个 position 自定义内容（留空则用 stock 默认 brand/preset 交替）；多行用 ';' 分隔 */
  content: Partial<Record<EdgePosition, string>>
  font: string
  fontSizeRatio: number
  opacity: number // 0–1
  align: 'left' | 'center' | 'right'
  letterSpacing: number
}

export interface FrameNoConfig {
  start: number
  step: number
  digits: number
  prefix: string
}

export type ExportFormat = 'jpeg' | 'png'
export type BackgroundType = 'transparent' | 'blur' | 'solid'

export interface ExportConfig {
  border: {
    formatId: FilmFormatId
    /** 手动指定画幅（film_format 值）影响自动匹配；null = 用照片属性 */
    filmFormatOverride: string | null
  }
  edgeText: EdgeTextConfig
  frameNo: FrameNoConfig
  image: {
    format: ExportFormat
    quality: number // 1–100
    /** 目标长边 px；null = 原尺寸（受上限约束） */
    longEdge: number | null
    /** 倍率；与 longEdge 二选一（longEdge 优先） */
    scale: number | null
    /** 照片裁切位置/缩放：始终 cover 填满，zoom≥1 放大裁切，offset 钳制。null=居中 */
    crop?: { zoom: number; offsetX: number; offsetY: number } | null
  }
  background: {
    type: BackgroundType
    color: string
    blurSigma: number
    paddingRatio: number
  }
  output: {
    dir: string
    filenameTemplate: string
    overwrite: 'skip' | 'overwrite' | 'rename'
  }
}

export interface BorderMatchResult {
  formatId: FilmFormatId
  filmFormat: string | null
  source: 'attr' | 'detect' | 'default'
  photoWidth: number | null
  photoHeight: number | null
  /** 匹配到的胶卷 stock 摘要（边字内容 + 工艺）供 UI 显示 */
  stockLabel: string
  stockEdgeText: string
}

export interface ExportPreset {
  id: number
  name: string
  is_builtin: number
  config: ExportConfig
  created_at: string
  updated_at: string
}

/** 默认导出配置（renderer 初始化用） */
export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  border: {
    formatId: '135',
    filmFormatOverride: null
  },
  edgeText: {
    enabled: true,
    stockId: 'auto',
    positions: ['top', 'bottom'],
    content: {},
    font: '"Courier New", monospace',
    fontSizeRatio: 0.86,
    opacity: 0.92,
    align: 'center',
    letterSpacing: 0
  },
  frameNo: { start: 1, step: 1, digits: 2, prefix: '' },
  image: {
    format: 'jpeg',
    quality: 92,
    longEdge: 2048,
    scale: null,
    crop: null
  },
  background: {
    type: 'solid',
    color: '#0a0a0a',
    blurSigma: 12,
    paddingRatio: 0.05
  },
  output: {
    dir: '',
    filenameTemplate: '{original}_{frame_no}',
    overwrite: 'rename'
  }
}

/** film_format 属性值 → 导出画幅 id（用于自动匹配） */
export function filmFormatToId(filmFormat: string | null): FilmFormatId {
  if (!filmFormat) return '135'
  const s = filmFormat
  if (s.includes('半格')) return 'half'
  if (s.includes('Xpan') || s.includes('宽幅')) return 'xpan'
  if (s.includes('645')) return '645'
  if (s.includes('6x6') || s.includes('6×6')) return '66'
  if (s.includes('6x7') || s.includes('6×7')) return '67'
  if (s.includes('6x8') || s.includes('6×8')) return '67' // 6×8 与 6×7 比例接近，归 67
  if (s.includes('6x9') || s.includes('6×9')) return '69'
  if (s.includes('6x12') || s.includes('6×12')) return '612'
  if (s.includes('6x17') || s.includes('6×17')) return '617'
  if (s.includes('4x5') || s.includes('8x10') || s.includes('大画幅')) return 'none'
  return '135'
}
