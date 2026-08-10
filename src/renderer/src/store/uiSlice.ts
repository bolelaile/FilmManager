import { create } from 'zustand'
import type { Photo, Roll } from '../types'

interface UISlice {
  thumbnailSize: 'small' | 'medium' | 'large'
  setThumbnailSize: (s: 'small' | 'medium' | 'large') => void

  viewMode: 'rolls' | 'photos'
  setViewMode: (m: 'rolls' | 'photos') => void

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
}

export const useUIStore = create<UISlice>((set) => ({
  thumbnailSize: 'medium',
  setThumbnailSize: (s) => set({ thumbnailSize: s }),

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
  setDetailPhotoId: (id) => set({ detailPhotoId: id })
}))
