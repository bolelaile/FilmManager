/**
 * 胶卷边字品牌库（移植自参考项目 film-index-generator 的 app.js stock 系统）。
 *
 * 真实胶片边字按"工艺(process)"决定墨色：
 *   C-41 彩色负片 → 曝光后橙色染料影像
 *   BW  黑白负片  → 银盐影像，亮白/浅灰
 *   E-6 反转片    → 暖肤色
 *   ECN-2 电影卷  → 米黄
 * 边字内容按帧交替 brand / preset（如 "135-36" "C-41" "DX 5063" "SAFETY FILM"）+ 帧号 + "A"后缀 + 条码竖条。
 */

export type FilmProcess = 'C-41' | 'BW' | 'E-6' | 'ECN-2'

export interface EdgeInk {
  color: string
  glow: string
}

export interface ProcessStyle {
  ink: EdgeInk
  /** 135 边字预设（按帧交替） */
  edgePresets: string[]
  /** 120 边字预设 */
  edgePresets120: string[]
  /** 帧号样式：N=纯数字，N/NA=数字+A后缀 */
  frameNumberStyle: 'N' | 'N/NA'
}

/** 按工艺的边字墨色 + 预设（移植参考项目 PROCESS 表） */
export const PROCESS_STYLES: Record<FilmProcess, ProcessStyle> = {
  'C-41': {
    ink: { color: 'rgba(255, 176, 64, 0.92)', glow: 'rgba(255, 170, 60, 0.45)' },
    edgePresets: ['135-36', 'C-41', 'DX 5063', 'SAFETY FILM', '135'],
    edgePresets120: ['120', 'C-41', 'SAFETY FILM'],
    frameNumberStyle: 'N/NA',
  },
  BW: {
    ink: { color: 'rgba(238, 238, 232, 0.92)', glow: 'rgba(240, 240, 235, 0.35)' },
    edgePresets: ['135-36', 'SAFETY FILM', 'DX 5063', 'PANCHROMATIC', '135'],
    edgePresets120: ['120', 'SAFETY FILM', 'PANCHROMATIC'],
    frameNumberStyle: 'N/NA',
  },
  'E-6': {
    ink: { color: 'rgba(249, 195, 148, 0.92)', glow: 'rgba(249, 195, 148, 0.4)' },
    edgePresets: ['135-36', 'E-6', 'SAFETY FILM', '135'],
    edgePresets120: ['120', 'E-6'],
    frameNumberStyle: 'N',
  },
  'ECN-2': {
    ink: { color: 'rgba(250, 230, 190, 0.92)', glow: 'rgba(250, 230, 190, 0.35)' },
    edgePresets: ['EASTMAN', 'KEEP FILM 5219', 'ECN-2', 'SAFETY FILM'],
    edgePresets120: ['EASTMAN', 'ECN-2', 'SAFETY FILM'],
    frameNumberStyle: 'N',
  },
}

export interface FilmStock {
  id: string
  name: string
  edgeText: string
  process: FilmProcess
}

/**
 * 内置胶卷品牌库。edgeText 为真实胶片边缘印刷的品牌全名（大写）。
 * 按应用现有 film 属性预设覆盖主流胶卷；process 由品牌+型号推断。
 */
export const BUILTIN_STOCKS: FilmStock[] = [
  // ── Kodak 彩色负片 (C-41) ──
  { id: 'kodak-portra-400', name: 'Kodak Portra 400', edgeText: 'KODAK PORTRA 400', process: 'C-41' },
  { id: 'kodak-portra-160', name: 'Kodak Portra 160', edgeText: 'KODAK PORTRA 160', process: 'C-41' },
  { id: 'kodak-portra-800', name: 'Kodak Portra 800', edgeText: 'KODAK PORTRA 800', process: 'C-41' },
  { id: 'kodak-gold-200', name: 'Kodak Gold 200', edgeText: 'KODAK GOLD 200', process: 'C-41' },
  { id: 'kodak-gold-100', name: 'Kodak Gold 100', edgeText: 'KODAK GOLD 100', process: 'C-41' },
  { id: 'kodak-ultramax-400', name: 'Kodak UltraMax 400', edgeText: 'KODAK ULTRAMAX 400', process: 'C-41' },
  { id: 'kodak-colorplus-200', name: 'Kodak ColorPlus 200', edgeText: 'KODAK COLORPLUS 200', process: 'C-41' },
  { id: 'kodak-ektar-100', name: 'Kodak Ektar 100', edgeText: 'KODAK EKTAR 100', process: 'C-41' },
  { id: 'kodak-proimage-100', name: 'Kodak ProImage 100', edgeText: 'KODAK PRO IMAGE 100', process: 'C-41' },
  // ── Kodak 黑白 (BW) ──
  { id: 'kodak-tri-x-400', name: 'Kodak Tri-X 400', edgeText: 'KODAK TRI-X 400', process: 'BW' },
  { id: 'kodak-tmax-100', name: 'Kodak T-Max 100', edgeText: 'KODAK T-MAX 100', process: 'BW' },
  { id: 'kodak-tmax-400', name: 'Kodak T-Max 400', edgeText: 'KODAK T-MAX 400', process: 'BW' },
  { id: 'kodak-tmax-p3200', name: 'Kodak P3200', edgeText: 'KODAK P3200', process: 'BW' },
  // ── Kodak 反转片 (E-6) ──
  { id: 'kodak-ektachrome-e100', name: 'Kodak Ektachrome E100', edgeText: 'KODAK EKTACHROME E100', process: 'E-6' },
  // ── Fujifilm 彩色负片 (C-41) ──
  { id: 'fujifilm-400', name: 'Fujifilm 400', edgeText: 'FUJIFILM 400', process: 'C-41' },
  { id: 'fujifilm-c400', name: 'Fujifilm C400', edgeText: 'FUJIFILM C400', process: 'C-41' },
  { id: 'fujicolor-c200', name: 'Fujicolor C200', edgeText: 'FUJICOLOR C200', process: 'C-41' },
  { id: 'fujifilm-superia-400', name: 'Fujifilm Superia 400', edgeText: 'FUJIFILM SUPERIA 400', process: 'C-41' },
  // ── Ilford 黑白 (BW) ──
  { id: 'ilford-hp5', name: 'Ilford HP5 Plus', edgeText: 'ILFORD HP5 PLUS', process: 'BW' },
  { id: 'ilford-fp4', name: 'Ilford FP4 Plus', edgeText: 'ILFORD FP4 PLUS', process: 'BW' },
  { id: 'ilford-delta-100', name: 'Ilford Delta 100', edgeText: 'ILFORD DELTA 100', process: 'BW' },
  { id: 'ilford-delta-400', name: 'Ilford Delta 400', edgeText: 'ILFORD DELTA 400', process: 'BW' },
  { id: 'ilford-xp2', name: 'Ilford XP2', edgeText: 'ILFORD XP2 SUPER', process: 'BW' },
  // ── Kentmere 黑白 (BW) ──
  { id: 'kentmere-pan-400', name: 'Kentmere Pan 400', edgeText: 'KENTMERE 400', process: 'BW' },
  // ── Lucky 乐凯 (C-41) ──
  { id: 'lucky-c200', name: 'Lucky C200', edgeText: 'LUCKY C200', process: 'C-41' },
  // ── 电影卷 ECN-2 ──
  { id: 'kodak-vision3-500', name: 'Kodak Vision3 500T', edgeText: 'KODAK VISION3 500T', process: 'ECN-2' },
  { id: 'cinestill-800t', name: 'Cinestill 800T', edgeText: 'CINESTILL 800T', process: 'ECN-2' },
]

export interface ResolvedStock {
  edgeText: string
  process: FilmProcess
  ink: EdgeInk
  edgePresets: string[]
  edgePresets120: string[]
  frameNumberStyle: 'N' | 'N/NA'
  matched: boolean
}

/** 规范化：去空格/分隔符转小写，保留中文 */
function normalize(s: string): string {
  return s.replace(/[\s\-_.\[\]/()]/g, '').toLowerCase()
}

/**
 * 用照片 film 属性值（如 "Kodak Portra 400 [135 / 35mm]"）匹配内置 stock。
 * 优先精确品牌+型号匹配，回退按品牌关键词推断 process（彩负默认 C-41、黑白关键词→BW）。
 */
export function resolveStock(filmAttrValue: string | null): ResolvedStock {
  const fallback: ResolvedStock = {
    edgeText: filmAttrValue?.replace(/\s*\[.*\]\s*/, '').trim().toUpperCase() || 'FILM',
    process: 'C-41', ...PROCESS_STYLES['C-41'], matched: false,
  }
  if (!filmAttrValue) return fallback

  const norm = normalize(filmAttrValue)
  // 精确匹配：stock name 或 edgeText 的规范化包含关系
  let best: FilmStock | undefined
  for (const s of BUILTIN_STOCKS) {
    const ns = normalize(s.name)
    if (norm.includes(ns) || ns.includes(norm)) {
      if (!best || ns.length > normalize(best.name).length) best = s
    }
  }
  if (best) {
    return { edgeText: best.edgeText, process: best.process, ...PROCESS_STYLES[best.process], matched: true }
  }

  // 回退：按品牌/工艺关键词推断 process
  const isBw = /trix|tri-x|t-max|tmax|hp5|fp4|delta|ilford|kentmere|fomapan|neopan|plus-x|ortho|xp2|sfx|rollei|harman|black|黑白|pan/i.test(filmAttrValue)
  const isE6 = /ektachrome|velvia|provia|slide|反转/i.test(filmAttrValue)
  const isEcn = /vision3|cinestill|ecn|电影|eastman/i.test(filmAttrValue)
  const process: FilmProcess = isEcn ? 'ECN-2' : isE6 ? 'E-6' : isBw ? 'BW' : 'C-41'
  const style = PROCESS_STYLES[process]
  return {
    edgeText: filmAttrValue.replace(/\s*\[.*\]\s*/, '').trim().toUpperCase() || 'FILM',
    process, ...style, matched: false,
  }
}
