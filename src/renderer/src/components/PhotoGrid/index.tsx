import React, { useRef, useCallback, useEffect, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Spin, Empty, Modal, message } from 'antd'
import {
  AppstoreOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  LoadingOutlined,
  RightOutlined,
  RotateRightOutlined,
  StarFilled,
  StarOutlined,
  SwapOutlined
} from '@ant-design/icons'
import type { Photo, AttributeType } from '../../types'
import PhotoCard from './PhotoCard'
import { FilmIconImg } from '../FilmIcon'
import { useStore } from '../../store'
import { useUIStore } from '../../store'
import { useShortcutListener } from '../../hooks/useShortcutListener'

// 窗口/全屏列数规格
// containerWidth >= WIDE_THRESHOLD → 全屏档，否则窗口档
const WIDE_THRESHOLD = 1400
const COLS: Record<'small' | 'medium' | 'large', { normal: number; wide: number }> = {
  small:  { normal: 1, wide: 2 },
  medium: { normal: 5, wide: 8 },
  large:  { normal: 3, wide: 5 },
}

// 缩略图下方信息栏高度
const INFO_BAR = { small: 0, medium: 46, large: 52 }
// 行间垂直间距（加在 rowHeight 里）
const ROW_GAP  = { small: 8, medium: 12, large: 28 }
// 卡片之间水平间距
const COL_GAP  = 12

// 小视图
const SMALL_IMG = 72   // 缩略图边长
const SMALL_ROW = 88   // 每行高度（图 72 + 上下内边距 + 间距）

interface PhotoGridProps {
  photos: Photo[]
  loading: boolean
  hasMore: boolean
  attrTypes: AttributeType[]
  onLoadMore: () => void
  onOpenViewer: (photo: Photo, index: number) => void
  onBatchEdit: () => void
  onBatchRotate: () => void
  onMoveToSubLibrary: () => void
  onPhotoDeleted: () => void
}

interface ContextMenuState { photo: Photo; targetIds: number[]; x: number; y: number }

export default function PhotoGrid({
  photos, loading, hasMore, attrTypes,
  onLoadMore, onOpenViewer, onBatchEdit, onBatchRotate, onMoveToSubLibrary, onPhotoDeleted
}: PhotoGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { thumbnailSize, selectedIds, toggleSelect, selectAll, clearSelection } = useStore()
  const { openExport, copiedAttrs, setCopiedAttrs } = useStore()
  const [containerWidth, setContainerWidth] = useState(0)
  // 本地 photos 副本，用于响应 photo-star-changed 事件的即时更新
  const [localPhotos, setLocalPhotos] = useState<Photo[]>(photos)
  useEffect(() => { setLocalPhotos(photos) }, [photos])
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, starred } = (e as CustomEvent).detail as { id: number; starred: number }
      setLocalPhotos((prev) => prev.map((p) => p.id === id ? { ...p, starred } : p))
    }
    window.addEventListener('photo-star-changed', handler)
    return () => window.removeEventListener('photo-star-changed', handler)
  }, [])

  const isSmall = thumbnailSize === 'small'

  // 列数：按宽度阈值切换窗口/全屏档
  const cols = (() => {
    if (containerWidth <= 0) return COLS[thumbnailSize].normal
    return containerWidth >= WIDE_THRESHOLD
      ? COLS[thumbnailSize].wide
      : COLS[thumbnailSize].normal
  })()

  // 卡片宽度：均分容器（小视图不需要）
  const cardWidth = isSmall
    ? 0
    : containerWidth > 0
      ? Math.max(60, Math.floor((containerWidth - COL_GAP * (cols + 1)) / cols))
      : 180

  const infoBar  = INFO_BAR[thumbnailSize]
  const rowGap   = ROW_GAP[thumbnailSize]
  const rowHeight = isSmall ? SMALL_ROW : cardWidth + infoBar + rowGap
  const rowCount  = Math.ceil(localPhotos.length / cols)

  // Box-selection refs
  const dragStartClientRef  = useRef<{ x: number; y: number } | null>(null)
  const dragStartContentRef = useRef<{ x: number; y: number } | null>(null)
  const isDraggingRef       = useRef(false)
  const justDraggedRef      = useRef(false)
  const [selBox, setSelBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [openWithApps, setOpenWithApps] = useState<{ name: string; exePath: string }[] | null>(null)
  const [openWithLoading, setOpenWithLoading] = useState(false)
  const [openWithSubmenuVisible, setOpenWithSubmenuVisible] = useState(false)

  // 悬停预览状态（仅大视图使用）
  const [hoveredPhoto, setHoveredPhoto] = useState<Photo | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handlePhotoHover = useCallback((photo: Photo) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    setHoveredPhoto(photo)
    // 立即显示缩略图（快速反馈）
    if (photo.thumb_path && photo.thumb_ready) {
      setPreviewUrl(`localfile://${encodeURIComponent(photo.thumb_path)}`)
    } else {
      setPreviewUrl(null)
    }
    // 延迟 280ms 加载全分辨率预览（防抖，避免快速滑过时频繁 IPC）
    hoverTimerRef.current = setTimeout(async () => {
      try {
        const result = await window.api.photos.fullPreview(photo.file_path, undefined, photo.rotation ?? 0) as { dataUrl: string } | null
        if (result) setPreviewUrl(result.dataUrl)
      } catch {}
    }, 280)
  }, [])

  useEffect(() => () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
  }, [])

  // ResizeObserver 监听容器宽度（含窗口拖拽、全屏切换）
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width)
    })
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  })

  // rowHeight 或 rowCount 变化时强制虚拟化器重算（避免陈旧缓存导致行叠压）
  const prevRowHeightRef = useRef(rowHeight)
  useEffect(() => {
    if (prevRowHeightRef.current !== rowHeight) {
      prevRowHeightRef.current = rowHeight
      rowVirtualizer.measure()
    }
  })

  // 切换视图模式时滚回顶部
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 })
  }, [thumbnailSize])

  // ── 网格键盘导航焦点 ─────────────────────────────────────────────────────────
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const viewerPhoto = useUIStore((s) => s.viewerPhoto)
  const gridShortcutsActive = !viewerPhoto

  const focusPhoto = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(localPhotos.length - 1, idx))
    setFocusedIndex(clamped)
    const row = Math.floor(clamped / cols)
    rowVirtualizer.scrollToIndex(row)
  }, [localPhotos.length, cols, rowVirtualizer])

  const currentTargetIds = useCallback(() => {
    if (selectedIds.size > 0) return [...selectedIds]
    if (focusedIndex != null && localPhotos[focusedIndex]) return [localPhotos[focusedIndex].id]
    return []
  }, [selectedIds, focusedIndex, localPhotos])

  const handleGridStar = useCallback(async () => {
    const ids = currentTargetIds()
    if (ids.length === 0) return
    if (ids.length === 1) {
      await window.api.photos.toggleStar(ids[0])
      const p = localPhotos.find((x) => x.id === ids[0])
      if (p) window.dispatchEvent(new CustomEvent('photo-star-changed', { detail: { id: ids[0], starred: p.starred ? 0 : 1 } }))
    } else {
      await window.api.photos.batchStar(ids, true)
      onPhotoDeleted() // 批量收藏需刷新列表
    }
  }, [currentTargetIds, localPhotos, onPhotoDeleted])

  const handleGridDelete = useCallback(async () => {
    const ids = currentTargetIds()
    if (ids.length === 0) return
    await window.api.photos.delete(ids, false)
    clearSelection()
    message.success(`已移入回收站 ${ids.length} 张照片`)
    onPhotoDeleted()
  }, [currentTargetIds, clearSelection, onPhotoDeleted])

  useShortcutListener(
    ['grid.up', 'grid.down', 'grid.left', 'grid.right', 'grid.open', 'grid.toggleSelect',
     'grid.star', 'grid.rotate', 'grid.delete', 'grid.moveToSubLib'],
    {
      'grid.up': () => focusPhoto((focusedIndex ?? 0) - cols),
      'grid.down': () => focusPhoto((focusedIndex ?? 0) + cols),
      'grid.left': () => focusPhoto((focusedIndex ?? 0) - 1),
      'grid.right': () => focusPhoto((focusedIndex ?? 0) + 1),
      'grid.open': () => { if (focusedIndex != null && localPhotos[focusedIndex]) onOpenViewer(localPhotos[focusedIndex], focusedIndex) },
      'grid.toggleSelect': () => { if (focusedIndex != null && localPhotos[focusedIndex]) toggleSelect(localPhotos[focusedIndex].id) },
      'grid.star': handleGridStar,
      'grid.rotate': () => { if (selectedIds.size > 0) onBatchRotate() },
      'grid.delete': handleGridDelete,
      'grid.moveToSubLib': () => { if (selectedIds.size > 0 || focusedIndex != null) onMoveToSubLibrary() },
    },
    gridShortcutsActive,
    true
  )

  // 无限加载触发
  useEffect(() => {
    const lastRow = rowVirtualizer.getVirtualItems().at(-1)
    if (lastRow && lastRow.index >= rowCount - 2 && hasMore && !loading) onLoadMore()
  }, [rowVirtualizer.getVirtualItems(), rowCount, hasMore, loading])

  // 右键菜单关闭
  useEffect(() => {
    if (!contextMenu) return
    const onClick = () => setContextMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null) }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  const getContentPos = (e: React.MouseEvent) => {
    const c = containerRef.current
    if (!c) return { x: 0, y: 0 }
    const rect = c.getBoundingClientRect()
    return { x: e.clientX - rect.left + c.scrollLeft, y: e.clientY - rect.top + c.scrollTop }
  }

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.photo-card')) return
    if (e.button !== 0) return
    e.preventDefault()
    dragStartClientRef.current = { x: e.clientX, y: e.clientY }
    dragStartContentRef.current = getContentPos(e)
    isDraggingRef.current = false
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStartClientRef.current) return
    const dx = e.clientX - dragStartClientRef.current.x
    const dy = e.clientY - dragStartClientRef.current.y
    if (!isDraggingRef.current && Math.abs(dx) < 6 && Math.abs(dy) < 6) return
    isDraggingRef.current = true
    setSelBox({
      left: Math.min(e.clientX, dragStartClientRef.current.x),
      top:  Math.min(e.clientY, dragStartClientRef.current.y),
      width: Math.abs(dx), height: Math.abs(dy)
    })
  }, [])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStartClientRef.current || !isDraggingRef.current) {
      dragStartClientRef.current = null
      dragStartContentRef.current = null
      setSelBox(null)
      return
    }
    const endContent = getContentPos(e)
    const start = dragStartContentRef.current!
    const selX = Math.min(start.x, endContent.x)
    const selY = Math.min(start.y, endContent.y)
    const selW = Math.abs(endContent.x - start.x)
    const selH = Math.abs(endContent.y - start.y)

    const selected: number[] = []
    localPhotos.forEach((photo, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      if (isSmall) {
        // 小视图：按行框选
        const cy = row * SMALL_ROW
        if (cy < selY + selH && cy + SMALL_ROW > selY) selected.push(photo.id)
      } else {
        const cx = COL_GAP + col * (cardWidth + COL_GAP)
        const cy = row * rowHeight
        if (cx < selX + selW && cx + cardWidth > selX && cy < selY + selH && cy + cardWidth > selY) {
          selected.push(photo.id)
        }
      }
    })
    if (selected.length > 0) selectAll(selected)

    justDraggedRef.current = true
    dragStartClientRef.current = null
    dragStartContentRef.current = null
    isDraggingRef.current = false
    setSelBox(null)
  }, [photos, cols, cardWidth, rowHeight, isSmall, selectAll])

  const handleContextMenu = useCallback((photo: Photo, x: number, y: number) => {
    const targetIds = selectedIds.has(photo.id) ? [...selectedIds] : [photo.id]
    if (!selectedIds.has(photo.id)) selectAll([photo.id])
    setContextMenu({ photo, targetIds, x, y })
  }, [selectedIds, selectAll])

  const handleRevealFile = () => {
    if (!contextMenu) return
    window.api.library.revealFile(contextMenu.photo.file_path)
    setContextMenu(null)
  }
  const handleCopyPath = () => {
    if (!contextMenu) return
    navigator.clipboard.writeText(contextMenu.photo.file_path)
    message.success('文件路径已复制到剪贴板')
    setContextMenu(null)
  }
  const handleDeleteFromLib = async () => {
    if (!contextMenu) return
    const targetIds = contextMenu.targetIds
    setContextMenu(null)
    const remove = async () => {
      await window.api.photos.delete(targetIds, false)
      clearSelection()
      message.success(`已移入回收站 ${targetIds.length} 张照片（可在设置 > 回收站恢复）`)
      onPhotoDeleted()
    }
    if (targetIds.length === 1) {
      await remove()
      return
    }
    Modal.confirm({
      title: `移入回收站 ${targetIds.length} 张照片？`,
      content: '照片将从列表移除，可在「设置 > 回收站」中恢复。',
      okText: '移入回收站',
      cancelText: '取消',
      onOk: remove
    })
  }

  const handleDeleteFile = async () => {
    if (!contextMenu) return
    const targetIds = contextMenu.targetIds
    // 统计其中 managed（可实际删除文件）的数量
    const managedCount = targetIds.filter((id) => {
      const p = localPhotos.find((ph) => ph.id === id)
      return p && p.storage_mode !== 'linked'
    }).length
    setContextMenu(null)
    Modal.confirm({
      title: targetIds.length > 1 ? `彻底删除 ${targetIds.length} 张照片？` : '彻底删除该照片？',
      content: managedCount < targetIds.length
        ? `其中 ${targetIds.length - managedCount} 张为索引链接模式，仅删除记录；${managedCount} 张的本地文件将被永久删除，无法恢复。`
        : '本地文件将被永久删除，无法恢复。',
      okText: '彻底删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await window.api.photos.purge(targetIds)
        clearSelection()
        message.success(`已彻底删除 ${targetIds.length} 张照片`)
        onPhotoDeleted()
      }
    })
  }
  const handleBatchEdit = () => {
    if (!contextMenu) return
    setContextMenu(null)
    onBatchEdit()
  }
  const handleBatchRotate = () => {
    if (!contextMenu) return
    setContextMenu(null)
    onBatchRotate()
  }
  const handleMoveToSubLibrary = () => {
    if (!contextMenu) return
    setContextMenu(null)
    onMoveToSubLibrary()
  }
  const handleExport = () => {
    if (!contextMenu) return
    const ids = contextMenu.targetIds
    setContextMenu(null)
    openExport(ids, ids.length > 1 ? `选中 ${ids.length} 张` : '当前照片')
  }

  const handleCopyAttrs = () => {
    if (!contextMenu) return
    const photo = contextMenu.photo
    setContextMenu(null)
    const attrs = (photo.attributes ?? []).map((a) => ({ typeId: a.attribute_type_id, valueId: a.value_id }))
    setCopiedAttrs(attrs)
    message.success(attrs.length > 0 ? `已复制 ${attrs.length} 项属性` : '该照片无属性可复制')
  }

  const handlePasteAttrs = async () => {
    if (!contextMenu) return
    const ids = contextMenu.targetIds
    setContextMenu(null)
    if (!copiedAttrs || copiedAttrs.length === 0) {
      message.info('剪贴板无属性')
      return
    }
    await window.api.photos.batchSetAttributes(ids, copiedAttrs)
    message.success(`已粘贴属性到 ${ids.length} 张照片`)
    onPhotoDeleted() // 复用刷新回调（会刷新 photos/attrs）
  }
  const handleBatchStar = async (starred: boolean) => {
    if (!contextMenu) return
    const ids = contextMenu.targetIds
    setContextMenu(null)
    await window.api.photos.batchStar(ids, starred)
    const newVal = starred ? 1 : 0
    setLocalPhotos((prev) => prev.map((p) => ids.includes(p.id) ? { ...p, starred: newVal } : p))
    ids.forEach((id) => window.dispatchEvent(new CustomEvent('photo-star-changed', { detail: { id, starred: newVal } })))
    message.success(starred ? `已收藏 ${ids.length} 张照片` : `已取消收藏 ${ids.length} 张照片`)
  }
  const handleSelectAll = () => {
    setContextMenu(null)
    selectAll(localPhotos.map((p) => p.id))
  }
  const handleInvertSelection = () => {
    setContextMenu(null)
    const invertedIds = localPhotos.filter((p) => !selectedIds.has(p.id)).map((p) => p.id)
    selectAll(invertedIds)
  }

  const handleOpenWithHover = async () => {
    setOpenWithSubmenuVisible(true)
    if (openWithApps !== null) return // already loaded
    setOpenWithLoading(true)
    try {
      const apps = await window.api.app.detectImageApps() as { name: string; exePath: string }[]
      setOpenWithApps(apps)
    } finally {
      setOpenWithLoading(false)
    }
  }

  const handleOpenWithApp = async (exePath: string) => {
    if (!contextMenu) return
    const filePaths = localPhotos
      .filter((p) => contextMenu.targetIds.includes(p.id))
      .map((p) => p.file_path)
    setContextMenu(null)
    setOpenWithSubmenuVisible(false)
    const ok = await window.api.app.openWithApp(exePath, filePaths) as boolean
    if (!ok) message.error('无法打开该应用，请确认程序路径正确')
  }

  if (!loading && localPhotos.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description={<span style={{ color: '#555' }}>暂无照片，点击"导入照片"开始</span>} />
      </div>
    )
  }

  const menuX = contextMenu ? Math.min(contextMenu.x, window.innerWidth - 200) : 0
  const menuY = contextMenu ? Math.min(contextMenu.y, window.innerHeight - 280) : 0
  const contextTargetCount = contextMenu?.targetIds.length ?? 0
  const showPreviewPanel = thumbnailSize === 'large'

  const gridNode = (
    <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', overflow: 'auto', userSelect: 'none', opacity: loading ? 0.4 : 1, transition: 'opacity 0.2s ease' }}
        onClick={(e) => {
          if (justDraggedRef.current) { justDraggedRef.current = false; return }
          if ((e.target as HTMLElement).closest('.photo-card') === null) clearSelection()
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          dragStartClientRef.current = null
          dragStartContentRef.current = null
          isDraggingRef.current = false
          setSelBox(null)
        }}
      >
        <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const startIdx = virtualRow.index * cols
            const rowPhotos = localPhotos.slice(startIdx, startIdx + cols)
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: virtualRow.start,
                  left: 0,
                  width: '100%',
                  height: rowHeight,
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: COL_GAP,
                  padding: `${rowGap / 2}px ${COL_GAP}px 0`,
                  boxSizing: 'border-box',
                }}
              >
                {rowPhotos.map((photo, i) => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    size={isSmall ? SMALL_IMG : cardWidth}
                    infoBarHeight={infoBar}
                    viewMode={thumbnailSize}
                    attrTypes={attrTypes}
                    selected={selectedIds.has(photo.id)}
                    onSelect={() => toggleSelect(photo.id)}
                    onDoubleClick={() => onOpenViewer(photo, startIdx + i)}
                    onContextMenu={handleContextMenu}
                    onHover={showPreviewPanel ? handlePhotoHover : undefined}
                    onCardDragStart={(e) => {
                      const ids = selectedIds.has(photo.id) ? [...selectedIds] : [photo.id]
                      e.dataTransfer.setData('application/x-film-photo-ids', JSON.stringify(ids))
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                  />
                ))}
              </div>
            )
          })}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin size="small" />
          </div>
        )}
      </div>

      {selBox && selBox.width > 4 && selBox.height > 4 && (
        <div style={{
          position: 'fixed',
          left: selBox.left, top: selBox.top,
          width: selBox.width, height: selBox.height,
          border: '1px solid var(--accent)',
          background: 'var(--accent-dim)',
          pointerEvents: 'none', zIndex: 500
        }} />
      )}

      {contextMenu && (
        <div
          style={{
            position: 'fixed', left: menuX, top: menuY,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)',
            borderRadius: 6, boxShadow: '0 4px 20px rgba(0,0,0,0.65)',
            zIndex: 2000, overflow: 'visible', minWidth: 188, padding: '4px 0'
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        >
          <CtxItem icon={<FolderOpenOutlined />} label="在文件管理器中打开" onClick={handleRevealFile} />
          <CtxItem icon={<CopyOutlined />} label="复制文件路径" onClick={handleCopyPath} />
          {/* 用其他应用打开 — 悬停展开子菜单 */}
          <div
            style={{ position: 'relative' }}
            onMouseEnter={handleOpenWithHover}
            onMouseLeave={() => setOpenWithSubmenuVisible(false)}
          >
            <CtxItem
              icon={<AppstoreOutlined />}
              label={contextTargetCount > 1 ? `用其他应用打开（${contextTargetCount} 张）` : '用其他应用打开'}
              suffix={<RightOutlined style={{ fontSize: 10, color: '#555' }} />}
              onClick={handleOpenWithHover}
            />
            {openWithSubmenuVisible && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: '100%',
                marginLeft: 2,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                borderRadius: 6,
                boxShadow: '0 4px 20px rgba(0,0,0,0.65)',
                minWidth: 180,
                maxHeight: 300,
                overflowY: 'auto',
                padding: '4px 0',
                zIndex: 2001
              }}>
                {openWithLoading && (
                  <div style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <LoadingOutlined /> 检测已安装应用…
                  </div>
                )}
                {!openWithLoading && openWithApps !== null && openWithApps.length === 0 && (
                  <div style={{ padding: '8px 12px', color: '#555', fontSize: 12 }}>
                    未检测到图像处理应用
                  </div>
                )}
                {!openWithLoading && openWithApps?.map((app) => (
                  <CtxItem
                    key={app.exePath}
                    icon={<AppstoreOutlined />}
                    label={app.name}
                    onClick={() => handleOpenWithApp(app.exePath)}
                  />
                ))}
              </div>
            )}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          <CtxItem
            icon={<EditOutlined />}
            label={contextTargetCount > 1 ? `批量编辑属性（${contextTargetCount} 张）` : '编辑属性'}
            onClick={handleBatchEdit}
          />
          <CtxItem icon={<CopyOutlined />} label="复制属性" onClick={handleCopyAttrs} />
          <CtxItem
            icon={<CopyOutlined />}
            label="粘贴属性"
            onClick={handlePasteAttrs}
            disabled={!copiedAttrs || copiedAttrs.length === 0}
          />
          <CtxItem
            icon={<RotateRightOutlined />}
            label={contextTargetCount > 1 ? `批量旋转 90°（${contextTargetCount} 张）` : '顺时针旋转 90°'}
            onClick={handleBatchRotate}
          />
          <CtxItem
            icon={<FolderOutlined />}
            label={contextTargetCount > 1 ? `批量移动到子库（${contextTargetCount} 张）` : '移动到子库'}
            onClick={handleMoveToSubLibrary}
          />
          <CtxItem
            icon={<DownloadOutlined />}
            label={contextTargetCount > 1 ? `导出（${contextTargetCount} 张）` : '导出'}
            onClick={handleExport}
          />
          {/* 收藏操作 */}
          {contextMenu.targetIds.some((id) => !localPhotos.find((p) => p.id === id)?.starred) && (
            <CtxItem
              icon={<StarFilled style={{ color: '#c8832a' }} />}
              label={contextTargetCount > 1 ? `收藏（${contextTargetCount} 张）` : '加入收藏'}
              onClick={() => handleBatchStar(true)}
            />
          )}
          {contextMenu.targetIds.some((id) => localPhotos.find((p) => p.id === id)?.starred) && (
            <CtxItem
              icon={<StarOutlined />}
              label={contextTargetCount > 1 ? `取消收藏（${contextTargetCount} 张）` : '取消收藏'}
              onClick={() => handleBatchStar(false)}
            />
          )}
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          <CtxItem icon={<AppstoreOutlined />} label="全选" onClick={handleSelectAll} />
          <CtxItem
            icon={<SwapOutlined />}
            label="反选"
            onClick={handleInvertSelection}
          />
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          <CtxItem
            icon={<DeleteOutlined />}
            label={contextTargetCount > 1 ? `移入回收站（${contextTargetCount} 张）` : '移入回收站'}
            onClick={handleDeleteFromLib}
            danger
          />
          {contextMenu.targetIds.some((id) => {
            const p = localPhotos.find((ph) => ph.id === id)
            return p && p.storage_mode !== 'linked'
          }) && (
            <CtxItem
              icon={<DeleteOutlined />}
              label={contextTargetCount > 1 ? `彻底删除（${contextTargetCount} 张）` : '彻底删除'}
              onClick={handleDeleteFile}
              danger
            />
          )}
        </div>
      )}
    </div>
  )

  if (!showPreviewPanel) {
    return gridNode
  }

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {gridNode}
      <HoverPreviewPanel
        photo={hoveredPhoto}
        previewUrl={previewUrl}
        attrTypes={attrTypes}
      />
    </div>
  )
}

// ── 右侧悬停预览面板 ────────────────────────────────────────────────
const PANEL_WIDTH = 360

function formatFileSize(bytes?: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 5, lineHeight: '16px' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 11, flexShrink: 0, width: 64, textAlign: 'right' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontSize: 11, flex: 1, minWidth: 0, overflowWrap: 'break-word' }}>{value}</span>
    </div>
  )
}

function HoverPreviewPanel({
  photo,
  previewUrl,
  attrTypes
}: {
  photo: Photo | null
  previewUrl: string | null
  attrTypes: AttributeType[]
}) {
  return (
    <div style={{
      width: PANEL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-base)', borderLeft: '1px solid var(--border)', overflow: 'hidden'
    }}>
      {/* 预览图区域：宽度100%，高度自适应（正方形），顶部留出间距 */}
      <div style={{
        width: '100%', aspectRatio: '1 / 1', flexShrink: 0,
        background: 'var(--bg-surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 12, boxSizing: 'border-box'
      }}>
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : photo ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)' }}>
            <FileImageOutlined style={{ fontSize: 36 }} />
            <div style={{ fontSize: 11, marginTop: 6 }}>{photo.file_type.toUpperCase()}</div>
          </div>
        ) : (
          <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>悬停照片预览</div>
        )}
      </div>

      {/* 元数据区域 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px 16px' }}>
        {photo ? (
          <>
            {/* 文件名 */}
            <div style={{
              color: 'var(--text-primary)', fontSize: 12, fontWeight: 500,
              marginBottom: 10, overflowWrap: 'break-word', lineHeight: '17px'
            }}>
              {photo.original_name}
            </div>

            {/* 基本文件信息 */}
            <InfoRow label="格式" value={photo.file_type.toUpperCase()} />
            {(photo.width && photo.height) ? (
              <InfoRow label="尺寸" value={`${photo.width} × ${photo.height}`} />
            ) : null}
            <InfoRow label="大小" value={formatFileSize(photo.file_size)} />
            {photo.shot_date && <InfoRow label="拍摄日期" value={photo.shot_date} />}
            <InfoRow label="入库日期" value={photo.imported_at.substring(0, 10)} />
            {photo.rotation ? <InfoRow label="旋转" value={`${photo.rotation}°`} /> : null}

            {/* 属性 */}
            {attrTypes
              .filter((t) => t.is_active)
              .map((t) => {
                const attr = photo.attributes?.find((a) => a.key === t.key)
                if (!attr) return null
                const isFilm = t.key === 'film'
                const iconKey = isFilm ? (attr as any).icon_key : null
                return (
                  <InfoRow
                    key={t.id}
                    label={t.display_name}
                    value={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {isFilm && iconKey && <FilmIconImg iconKey={iconKey} size={11} />}
                        {attr.value}
                      </span>
                    }
                  />
                )
              })}

            {/* 备注 */}
            {photo.notes && <InfoRow label="备注" value={photo.notes} />}
          </>
        ) : (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8, textAlign: 'center' }}>
            将鼠标移到照片上查看详情
          </div>
        )}
      </div>
    </div>
  )
}

function CtxItem({
  icon,
  label,
  onClick,
  danger,
  suffix,
  disabled
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  suffix?: React.ReactNode
  disabled?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      style={{
        minHeight: 32, padding: '7px 12px', fontSize: 13,
        display: 'flex', alignItems: 'center', gap: 9,
        color: disabled ? '#555' : danger ? '#ff6b6b' : '#ccc',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: hovered && !disabled ? '#2a2a2a' : 'transparent',
        transition: 'background 0.1s'
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={disabled ? undefined : onClick}
    >
      <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {suffix && <span style={{ marginLeft: 'auto' }}>{suffix}</span>}
    </div>
  )
}
