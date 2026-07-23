import React, { useRef, useCallback, useEffect, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Spin, Empty, message } from 'antd'
import type { Photo, AttributeType } from '../../types'
import PhotoCard from './PhotoCard'
import { useStore } from '../../store'

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
  onPhotoDeleted: () => void
}

interface ContextMenuState { photo: Photo; x: number; y: number }

export default function PhotoGrid({
  photos, loading, hasMore, attrTypes,
  onLoadMore, onOpenViewer, onPhotoDeleted
}: PhotoGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { thumbnailSize, selectedIds, toggleSelect, selectAll, clearSelection } = useStore()
  const [containerWidth, setContainerWidth] = useState(0)

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
  const rowCount  = Math.ceil(photos.length / cols)

  // Box-selection refs
  const dragStartClientRef  = useRef<{ x: number; y: number } | null>(null)
  const dragStartContentRef = useRef<{ x: number; y: number } | null>(null)
  const isDraggingRef       = useRef(false)
  const justDraggedRef      = useRef(false)
  const [selBox, setSelBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

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
    photos.forEach((photo, i) => {
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
    setContextMenu({ photo, x, y })
  }, [])

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
    const id = contextMenu.photo.id
    setContextMenu(null)
    await window.api.photos.delete([id], false)
    message.success('已从库中移除')
    onPhotoDeleted()
  }

  if (!loading && photos.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description={<span style={{ color: '#555' }}>暂无照片，点击"导入照片"开始</span>} />
      </div>
    )
  }

  const menuX = contextMenu ? Math.min(contextMenu.x, window.innerWidth - 200) : 0
  const menuY = contextMenu ? Math.min(contextMenu.y, window.innerHeight - 130) : 0

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div
        ref={containerRef}
        style={{ height: '100%', overflow: 'auto', userSelect: 'none' }}
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
            const rowPhotos = photos.slice(startIdx, startIdx + cols)
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
          border: '1px solid #c8832a',
          background: 'rgba(200,131,42,0.08)',
          pointerEvents: 'none', zIndex: 500
        }} />
      )}

      {contextMenu && (
        <div
          style={{
            position: 'fixed', left: menuX, top: menuY,
            background: '#1e1e1e', border: '1px solid #2e2e2e',
            borderRadius: 6, boxShadow: '0 4px 20px rgba(0,0,0,0.65)',
            zIndex: 2000, overflow: 'hidden', minWidth: 188, padding: '4px 0'
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        >
          <CtxItem label="在文件管理器中打开" onClick={handleRevealFile} />
          <CtxItem label="复制文件路径" onClick={handleCopyPath} />
          <div style={{ borderTop: '1px solid #2a2a2a', margin: '4px 0' }} />
          <CtxItem label="从库中删除" onClick={handleDeleteFromLib} danger />
        </div>
      )}
    </div>
  )
}

function CtxItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      style={{
        padding: '7px 16px', fontSize: 13,
        color: danger ? '#ff6b6b' : '#ccc',
        cursor: 'pointer',
        background: hovered ? '#2a2a2a' : 'transparent',
        transition: 'background 0.1s'
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {label}
    </div>
  )
}
