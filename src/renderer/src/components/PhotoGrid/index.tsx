import React, { useRef, useCallback, useEffect, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Spin, Empty, Modal, message } from 'antd'
import {
  AppstoreOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  LoadingOutlined,
  RightOutlined,
  RotateRightOutlined
} from '@ant-design/icons'
import type { Photo, AttributeType } from '../../types'
import PhotoCard from './PhotoCard'
import { FilmIconImg } from '../FilmIcon'
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
      message.success(`已从库中移除 ${targetIds.length} 张照片`)
      onPhotoDeleted()
    }
    if (targetIds.length === 1) {
      await remove()
      return
    }
    Modal.confirm({
      title: `从库中移除 ${targetIds.length} 张照片？`,
      content: '只移除 FilmManager 中的索引，本地照片文件会保留。',
      okText: '移除',
      cancelText: '取消',
      onOk: remove
    })
  }

  const handleDeleteFile = async () => {
    if (!contextMenu) return
    const targetIds = contextMenu.targetIds
    // 统计其中 managed（可实际删除文件）的数量
    const managedCount = targetIds.filter((id) => {
      const p = photos.find((ph) => ph.id === id)
      return p && p.storage_mode !== 'linked'
    }).length
    setContextMenu(null)
    Modal.confirm({
      title: targetIds.length > 1 ? `永久删除 ${targetIds.length} 张照片的文件？` : '永久删除该照片文件？',
      content: managedCount < targetIds.length
        ? `其中 ${targetIds.length - managedCount} 张为索引链接模式，仅删除索引；${managedCount} 张的本地文件将被永久删除，无法恢复。`
        : '本地文件将被永久删除，无法恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await window.api.photos.delete(targetIds, true)
        clearSelection()
        message.success(`已删除 ${targetIds.length} 张照片`)
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
    const filePaths = photos
      .filter((p) => contextMenu.targetIds.includes(p.id))
      .map((p) => p.file_path)
    setContextMenu(null)
    setOpenWithSubmenuVisible(false)
    const ok = await window.api.app.openWithApp(exePath, filePaths) as boolean
    if (!ok) message.error('无法打开该应用，请确认程序路径正确')
  }

  if (!loading && photos.length === 0) {
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
        style={{ width: '100%', height: '100%', overflow: 'auto', userSelect: 'none' }}
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
                    onHover={showPreviewPanel ? handlePhotoHover : undefined}
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
                background: '#1e1e1e',
                border: '1px solid #2e2e2e',
                borderRadius: 6,
                boxShadow: '0 4px 20px rgba(0,0,0,0.65)',
                minWidth: 180,
                maxHeight: 300,
                overflowY: 'auto',
                padding: '4px 0',
                zIndex: 2001
              }}>
                {openWithLoading && (
                  <div style={{ padding: '8px 12px', color: '#666', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
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
          <div style={{ borderTop: '1px solid #2a2a2a', margin: '4px 0' }} />
          <CtxItem
            icon={<EditOutlined />}
            label={contextTargetCount > 1 ? `批量编辑属性（${contextTargetCount} 张）` : '编辑属性'}
            onClick={handleBatchEdit}
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
          <div style={{ borderTop: '1px solid #2a2a2a', margin: '4px 0' }} />
          <CtxItem
            icon={<DeleteOutlined />}
            label={contextTargetCount > 1 ? `从库中移除（${contextTargetCount} 张）` : '从库中移除'}
            onClick={handleDeleteFromLib}
            danger
          />
          {contextMenu.targetIds.some((id) => {
            const p = photos.find((ph) => ph.id === id)
            return p && p.storage_mode !== 'linked'
          }) && (
            <CtxItem
              icon={<DeleteOutlined />}
              label={contextTargetCount > 1 ? `删除文件（${contextTargetCount} 张）` : '删除文件'}
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
      <span style={{ color: '#666', fontSize: 11, flexShrink: 0, width: 64, textAlign: 'right' }}>{label}</span>
      <span style={{ color: '#bbb', fontSize: 11, flex: 1, minWidth: 0, overflowWrap: 'break-word' }}>{value}</span>
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
      background: '#141414', borderLeft: '1px solid #222', overflow: 'hidden'
    }}>
      {/* 预览图区域：宽度100%，高度自适应（正方形），顶部留出间距 */}
      <div style={{
        width: '100%', aspectRatio: '1 / 1', flexShrink: 0,
        background: '#0e0e0e',
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
          <div style={{ textAlign: 'center', color: '#333' }}>
            <FileImageOutlined style={{ fontSize: 36 }} />
            <div style={{ fontSize: 11, marginTop: 6 }}>{photo.file_type.toUpperCase()}</div>
          </div>
        ) : (
          <div style={{ color: '#333', fontSize: 12 }}>悬停照片预览</div>
        )}
      </div>

      {/* 元数据区域 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px 16px' }}>
        {photo ? (
          <>
            {/* 文件名 */}
            <div style={{
              color: '#ddd', fontSize: 12, fontWeight: 500,
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
          <div style={{ color: '#444', fontSize: 12, marginTop: 8, textAlign: 'center' }}>
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
  suffix
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  suffix?: React.ReactNode
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      style={{
        minHeight: 32, padding: '7px 12px', fontSize: 13,
        display: 'flex', alignItems: 'center', gap: 9,
        color: danger ? '#ff6b6b' : '#ccc',
        cursor: 'pointer',
        background: hovered ? '#2a2a2a' : 'transparent',
        transition: 'background 0.1s'
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {suffix && <span style={{ marginLeft: 'auto' }}>{suffix}</span>}
    </div>
  )
}
