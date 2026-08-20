import { create } from 'zustand'
import type { Photo, Roll } from '../types'

export type AppTheme = 'film-dark' | 'midnight-blue' | 'forest-night' | 'deep-ocean' | 'obsidian'

export interface ThemeConfig {
  id: AppTheme
  label: string
  accent: string
  accentDim: string
  bgBase: string
  bgSurface: string
  bgElevated: string
  bgHeader: string
  border: string
  borderStrong: string
  textPrimary: string
  textSecondary: string
  textDim: string
}

export const THEMES: ThemeConfig[] = [
  {
    id: 'film-dark',
    label: '胶片暗室',
    accent: '#c8832a',
    accentDim: 'rgba(200,131,42,0.10)',
    bgBase: '#141414',
    bgSurface: '#1a1a1a',
    bgElevated: '#222',
    bgHeader: '#1a1a1a',
    border: '#2a2a2a',
    borderStrong: '#333',
    textPrimary: '#e0e0e0',
    textSecondary: '#888',
    textDim: '#444'
  },
  {
    id: 'midnight-blue',
    label: '深夜蓝',
    accent: '#58a6ff',
    accentDim: 'rgba(88,166,255,0.12)',
    bgBase: '#0d1117',
    bgSurface: '#161b22',
    bgElevated: '#21262d',
    bgHeader: '#161b22',
    border: '#30363d',
    borderStrong: '#484f58',
    textPrimary: '#e6edf3',
    textSecondary: '#7d8590',
    textDim: '#3d444d'
  },
  {
    id: 'forest-night',
    label: '暗夜森林',
    accent: '#3fb950',
    accentDim: 'rgba(63,185,80,0.12)',
    bgBase: '#0d120f',
    bgSurface: '#121a14',
    bgElevated: '#1a2b1c',
    bgHeader: '#121a14',
    border: '#243027',
    borderStrong: '#3a5040',
    textPrimary: '#d0e8d2',
    textSecondary: '#6b9070',
    textDim: '#2d4832'
  },
  {
    id: 'deep-ocean',
    label: '深海',
    accent: '#7dd3fc',
    accentDim: 'rgba(125,211,252,0.12)',
    bgBase: '#040d1a',
    bgSurface: '#071224',
    bgElevated: '#0d1e38',
    bgHeader: '#071224',
    border: '#112647',
    borderStrong: '#1d3d6b',
    textPrimary: '#bcd8f0',
    textSecondary: '#4a7faa',
    textDim: '#1a3a5c'
  },
  {
    id: 'obsidian',
    label: '黑曜石',
    accent: '#a78bfa',
    accentDim: 'rgba(167,139,250,0.12)',
    bgBase: '#08080c',
    bgSurface: '#0f0f16',
    bgElevated: '#18181f',
    bgHeader: '#0f0f16',
    border: '#22222e',
    borderStrong: '#32323f',
    textPrimary: '#e0dff5',
    textSecondary: '#7070a0',
    textDim: '#2e2e42'
  }
]

export function applyTheme(t: ThemeConfig): void {
  const r = document.documentElement.style
  r.setProperty('--accent', t.accent)
  r.setProperty('--accent-dim', t.accentDim)
  r.setProperty('--bg-base', t.bgBase)
  r.setProperty('--bg-surface', t.bgSurface)
  r.setProperty('--bg-elevated', t.bgElevated)
  r.setProperty('--bg-header', t.bgHeader)
  r.setProperty('--border', t.border)
  r.setProperty('--border-strong', t.borderStrong)
  r.setProperty('--text-primary', t.textPrimary)
  r.setProperty('--text-secondary', t.textSecondary)
  r.setProperty('--text-dim', t.textDim)
}

interface UISlice {
  thumbnailSize: 'small' | 'medium' | 'large'
  setThumbnailSize: (s: 'small' | 'medium' | 'large') => void

  rollThumbnailSize: 'small' | 'medium' | 'large'
  setRollThumbnailSize: (s: 'small' | 'medium' | 'large') => void

  viewMode: 'rolls' | 'photos' | 'timeline'
  setViewMode: (m: 'rolls' | 'photos' | 'timeline') => void

  activeRoll: Roll | null
  setActiveRoll: (r: Roll | null) => void

  viewerPhoto: Photo | null
  setViewerPhoto: (p: Photo | null) => void
  viewerPhotos: Photo[]
  setViewerPhotos: (ps: Photo[]) => void
  viewerIndex: number
  setViewerIndex: (i: number) => void
  closeViewer: () => void

  settingsOpen: boolean
  setSettingsOpen: (v: boolean) => void

  detailPhotoId: number | null
  setDetailPhotoId: (id: number | null) => void

  appTheme: AppTheme
  setAppTheme: (t: AppTheme) => void

  // 导出弹窗
  exportOpen: boolean
  exportPhotoIds: number[]
  exportLabel: string
  openExport: (photoIds: number[], label?: string) => void
  closeExport: () => void

  // 导出进度浮层
  exportProgress: { done: number; total: number; success: number; failed: number } | null
  setExportProgress: (p: { done: number; total: number; success: number; failed: number } | null) => void
}

export const useUIStore = create<UISlice>((set) => ({
  thumbnailSize: 'medium',
  setThumbnailSize: (s) => set({ thumbnailSize: s }),

  rollThumbnailSize: 'medium',
  setRollThumbnailSize: (s) => set({ rollThumbnailSize: s }),

  viewMode: 'photos',
  setViewMode: (m) => set({ viewMode: m }),

  activeRoll: null,
  setActiveRoll: (r) => set({ activeRoll: r }),

  viewerPhoto: null,
  setViewerPhoto: (p) => set({ viewerPhoto: p }),
  viewerPhotos: [],
  setViewerPhotos: (ps) => set({ viewerPhotos: ps }),
  viewerIndex: 0,
  setViewerIndex: (i) => set({ viewerIndex: i }),
  closeViewer: () => set({ viewerPhoto: null, viewerPhotos: [], viewerIndex: 0 }),

  settingsOpen: false,
  setSettingsOpen: (v) => set({ settingsOpen: v }),

  detailPhotoId: null,
  setDetailPhotoId: (id) => set({ detailPhotoId: id }),

  appTheme: 'film-dark',
  setAppTheme: (t) => {
    const cfg = THEMES.find((x) => x.id === t) ?? THEMES[0]
    applyTheme(cfg)
    set({ appTheme: t })
  },

  exportOpen: false,
  exportPhotoIds: [],
  exportLabel: '当前照片',
  openExport: (photoIds, label = '当前照片') => set({ exportOpen: true, exportPhotoIds: photoIds, exportLabel: label }),
  closeExport: () => set({ exportOpen: false }),

  exportProgress: null,
  setExportProgress: (p) => set({ exportProgress: p })
}))

