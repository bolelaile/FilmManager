import React, { useRef, useEffect, useState, useCallback } from 'react'
import { Spin, Empty, Tooltip, Tag, message, Popover, Modal, Select, Button, Divider, Space, Radio, Input } from 'antd'
import {
  DeleteOutlined, EditOutlined, EnvironmentOutlined, PictureOutlined,
  CloseOutlined, AppstoreOutlined, DownloadOutlined
} from '@ant-design/icons'
import type { Roll, AttributeType, AttributeValue, Location } from '../../types'
import { FilmIconImg, FilmTag, FilmIconPicker } from '../FilmIcon'
import LocationPicker from '../LocationPicker'
import { useStore } from '../../store'

// ── 布局常量 ─────────────────────────────────────────────────────────────────
const WIDE_THRESHOLD = 1400
const COL_GAP = 16
const ROW_GAP = 16

const COLS: Record<'small' | 'medium' | 'large', { normal: number; wide: number }> = {
  small:  { normal: 1, wide: 2 },
  medium: { normal: 4, wide: 6 },
  large:  { normal: 2, wide: 3 },
}

// 封面图高度（medium 固定）
const COVER_H_MEDIUM = 148
const INFO_H_MEDIUM  = 72
// 小视图行高
const SMALL_ROW  = 80
// 大视图横向行高（方案A：左封面55% + 右信息45%，固定高度）
const LARGE_ROW_H = 220

// ── 类型 ──────────────────────────────────────────────────────────────────────
interface RollsViewProps {
  rolls: Roll[]
  photolessCount: number
  loading: boolean
  attrTypes: AttributeType[]
  onRollClick: (roll: Roll) => void
  onOtherPhotosClick: () => void
  onRollDeleted: () => void
  onRollRenamed: () => void
  onRollLocationChanged?: () => void
}

interface ContextMenuState {
  rollIds: number[]   // 右键时已选中的卷 id 集合
  x: number
  y: number
}

// ── 主组件 ────────────────────────────────────────────────────────────────────
export default function RollsView({
  rolls, photolessCount, loading, attrTypes,
  onRollClick, onOtherPhotosClick, onRollDeleted, onRollRenamed, onRollLocationChanged
}: RollsViewProps) {
  const { rollThumbnailSize: size } = useStore()
  const { openExport } = useStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [thumbCache, setThumbCache] = useState<Record<number, string>>({})

  // ── 重命名 ──────────────────────────────────────────────────────────────────
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameName, setRenameName] = useState('')

  // ── 多选 ────────────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // 框选 (rubber-band)
  const dragStartClientRef  = useRef<{ x: number; y: number } | null>(null)
  const dragStartContentRef = useRef<{ x: number; y: number } | null>(null)
  const isDraggingRef       = useRef(false)
  const justDraggedRef      = useRef(false)
  const [selBox, setSelBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  // ── 右键菜单 ────────────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // ── 批量属性编辑 ─────────────────────────────────────────────────────────────
  const [batchAttrOpen, setBatchAttrOpen] = useState(false)
  const [batchAttrs, setBatchAttrs] = useState<Record<number, number | null>>({})
  const [typeValues, setTypeValues] = useState<Record<number, AttributeValue[]>>({})
  const [filmValues, setFilmValues] = useState<AttributeValue[]>([])
  const [filmTypeId, setFilmTypeId] = useState<number | null>(null)
  const [filmPickerOpen, setFilmPickerOpen] = useState(false)

  // ── 删除模态框 ───────────────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteMode, setDeleteMode] = useState<'roll_only' | 'roll_and_photos' | 'roll_and_files'>('roll_only')
  const [deleting, setDeleting] = useState(false)
  // 单卷删除时临时存储 id（null = 批量删除）
  const deleteIdsRef = useRef<number[]>([])

  const filmType       = attrTypes.find((t) => t.key === 'film')
  const filmFormatType = attrTypes.find((t) => t.key === 'film_format')

  // 布局计算
  const cols = containerWidth >= WIDE_THRESHOLD ? COLS[size].wide : COLS[size].normal
  const isSmall  = size === 'small'
  const isLarge  = size === 'large'
  // 大视图：横向行，宽度 = 两列平铺（1 col 时全宽，2 col 时各占一半）
  const largeRowWidth = containerWidth > 0
    ? Math.floor((containerWidth - 40 - COL_GAP * (cols - 1)) / cols)
    : 400
  // 中视图：网格卡片宽度
  const cardWidth = isSmall || isLarge
    ? 0
    : containerWidth > 0
      ? Math.floor((containerWidth - 40 - COL_GAP * (cols - 1)) / cols)
      : 200
  const cardHeight = isSmall ? SMALL_ROW : isLarge ? LARGE_ROW_H : COVER_H_MEDIUM + INFO_H_MEDIUM

  // ResizeObserver
  useEffect(() => {
    const ro = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width))
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // 缩略图加载
  useEffect(() => {
    const toLoad = rolls.filter((r) => r.thumb_path && r.thumb_ready && !thumbCache[r.id])
    if (toLoad.length === 0) return
    toLoad.forEach(async (roll) => {
      if (!roll.thumb_path) return
      try {
        const url = await window.api.photos.thumbDataUrl(roll.thumb_path) as string
        if (url) setThumbCache((prev) => ({ ...prev, [roll.id]: url }))
      } catch {}
    })
  }, [rolls])

  // 批量属性编辑时加载值列表
  useEffect(() => {
    if (!batchAttrOpen || attrTypes.length === 0) return
    const ft = attrTypes.find((t) => t.key === 'film')
    if (ft) setFilmTypeId(ft.id)
    attrTypes.forEach((t) => {
      window.api.attrs.listValues(t.id).then((vals) => {
        const values = vals as AttributeValue[]
        setTypeValues((prev) => ({ ...prev, [t.id]: values }))
        if (t.key === 'film') setFilmValues(values)
      })
    })
  }, [batchAttrOpen, attrTypes])

  // 右键菜单关闭
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null) }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', onKey) }
  }, [contextMenu])

  // ── 重命名 ──────────────────────────────────────────────────────────────────
  const handleRename = async (id: number) => {
    if (!renameName.trim()) { setRenamingId(null); return }
    await window.api.rolls.rename(id, renameName.trim())
    setRenamingId(null)
    onRollRenamed()
  }

  // ── 多选辅助 ────────────────────────────────────────────────────────────────
  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const handleContextMenu = useCallback((roll: Roll, x: number, y: number) => {
    // 若右键点击的卷不在已选中集合里，则只选中该卷
    setSelectedIds((prev) => {
      if (!prev.has(roll.id)) {
        setContextMenu({ rollIds: [roll.id], x, y })
        return new Set([roll.id])
      }
      setContextMenu({ rollIds: [...prev], x, y })
      return prev
    })
  }, [])

  // ── 框选 ────────────────────────────────────────────────────────────────────
  const getContentPos = (e: React.MouseEvent) => {
    const c = containerRef.current
    if (!c) return { x: 0, y: 0 }
    const rect = c.getBoundingClientRect()
    return { x: e.clientX - rect.left + c.scrollLeft, y: e.clientY - rect.top + c.scrollTop }
  }

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.roll-card')) return
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
      left:   Math.min(e.clientX, dragStartClientRef.current.x),
      top:    Math.min(e.clientY, dragStartClientRef.current.y),
      width:  Math.abs(dx),
      height: Math.abs(dy)
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

    const hit: number[] = []
    rolls.forEach((roll, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      if (isSmall) {
        // 小视图：按行框选（全宽）
        const cy = row * (SMALL_ROW + ROW_GAP)
        if (cy < selY + selH && cy + SMALL_ROW > selY) hit.push(roll.id)
      } else if (isLarge) {
        // 大视图：横向详情行，宽度 = largeRowWidth
        const cx = col * (largeRowWidth + COL_GAP)
        const cy = row * (LARGE_ROW_H + ROW_GAP)
        if (cx < selX + selW && cx + largeRowWidth > selX &&
            cy < selY + selH && cy + LARGE_ROW_H > selY) hit.push(roll.id)
      } else {
        const cx = col * (cardWidth + COL_GAP)
        const cy = row * (cardHeight + ROW_GAP)
        if (cx < selX + selW && cx + cardWidth > selX &&
            cy < selY + selH && cy + cardHeight > selY) hit.push(roll.id)
      }
    })
    if (hit.length > 0) setSelectedIds(new Set(hit))

    justDraggedRef.current = true
    dragStartClientRef.current = null
    dragStartContentRef.current = null
    isDraggingRef.current = false
    setSelBox(null)
  }, [rolls, cols, cardWidth, cardHeight, isSmall])

  // ── 删除 ────────────────────────────────────────────────────────────────────
  const openDeleteModal = (ids: number[]) => {
    deleteIdsRef.current = ids
    setDeleteMode('roll_only')
    setDeleteOpen(true)
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const ids = deleteIdsRef.current
      const deletePhotos = deleteMode !== 'roll_only'
      const deleteFiles  = deleteMode === 'roll_and_files'
      if (ids.length === 1) {
        await window.api.rolls.delete(ids[0], deletePhotos, deleteFiles)
      } else {
        await window.api.rolls.batchDelete(ids, deletePhotos, deleteFiles)
      }
      message.success(`已删除 ${ids.length} 个卷` + (deletePhotos ? '及其照片' : ''))
      setDeleteOpen(false)
      setSelectedIds(new Set())
      setContextMenu(null)
      onRollDeleted()
    } finally {
      setDeleting(false)
    }
  }

  // ── 批量属性 ─────────────────────────────────────────────────────────────────
  const handleBatchSetAttrs = async () => {
    const ids = contextMenu ? contextMenu.rollIds : [...selectedIds]
    const pairs = Object.entries(batchAttrs)
      .filter(([, vid]) => vid != null)
      .map(([tid, vid]) => ({ typeId: Number(tid), valueId: vid! }))
    if (pairs.length === 0) { message.info('请至少选择一个属性值'); return }
    await window.api.rolls.batchSetAttributes(ids, pairs)
    message.success(`已为 ${ids.length} 个卷的照片设置属性`)
    setBatchAttrOpen(false)
    setBatchAttrs({})
    setContextMenu(null)
    onRollDeleted()  // 触发重新加载
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (rolls.length === 0 && photolessCount === 0) {
    return <Empty description={<span style={{ color: '#555' }}>暂无卷，请选择照片后创建</span>} style={{ paddingTop: 80 }} />
  }

  // 右键菜单定位
  const menuX = contextMenu ? Math.min(contextMenu.x, window.innerWidth - 200) : 0
  const menuY = contextMenu ? Math.min(contextMenu.y, window.innerHeight - 260) : 0
  const ctxCount = contextMenu?.rollIds.length ?? 0

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      {/* ── 滚动容器（框选事件挂在这里） ────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', overflow: 'auto', userSelect: 'none' }}
        onClick={(e) => {
          if (justDraggedRef.current) { justDraggedRef.current = false; return }
          if ((e.target as HTMLElement).closest('.roll-card') === null) setSelectedIds(new Set())
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
        <div style={{ padding: '16px 20px' }}>
          {isSmall ? (
            /* ── 小视图：横向列表 ───────────────────────────────────────── */
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gap: ROW_GAP
            }}>
              {rolls.map((roll) => (
                <SmallRollRow
                  key={roll.id}
                  roll={roll}
                  thumbUrl={thumbCache[roll.id]}
                  filmType={filmType}
                  filmFormatType={filmFormatType}
                  selected={selectedIds.has(roll.id)}
                  renamingId={renamingId}
                  renameName={renameName}
                  onSetRenamingId={setRenamingId}
                  onSetRenameName={setRenameName}
                  onRename={handleRename}
                  onRollClick={onRollClick}
                  onToggleSelect={toggleSelect}
                  onContextMenu={handleContextMenu}
                  onLocationChanged={onRollLocationChanged}
                />
              ))}
              {photolessCount > 0 && (
                <OtherPhotosSmallRow count={photolessCount} onClick={onOtherPhotosClick} />
              )}
            </div>
          ) : isLarge ? (
            /* ── 大视图：横向详情行（方案 A）───────────────────────────── */
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, ${largeRowWidth}px)`,
              gap: `${ROW_GAP}px ${COL_GAP}px`
            }}>
              {rolls.map((roll) => (
                <LargeRollRow
                  key={roll.id}
                  roll={roll}
                  rowWidth={largeRowWidth}
                  thumbUrl={thumbCache[roll.id]}
                  filmType={filmType}
                  filmFormatType={filmFormatType}
                  selected={selectedIds.has(roll.id)}
                  renamingId={renamingId}
                  renameName={renameName}
                  onSetRenamingId={setRenamingId}
                  onSetRenameName={setRenameName}
                  onRename={handleRename}
                  onRollClick={onRollClick}
                  onToggleSelect={toggleSelect}
                  onContextMenu={handleContextMenu}
                  onLocationChanged={onRollLocationChanged}
                />
              ))}
              {photolessCount > 0 && (
                <OtherPhotosLargeRow rowWidth={largeRowWidth} count={photolessCount} onClick={onOtherPhotosClick} />
              )}
            </div>
          ) : (
            /* ── 中视图：卡片网格 ──────────────────────────────────────── */
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, ${cardWidth}px)`,
              gap: `${ROW_GAP}px ${COL_GAP}px`
            }}>
              {rolls.map((roll) => (
                <RollCard
                  key={roll.id}
                  roll={roll}
                  cardWidth={cardWidth}
                  thumbUrl={thumbCache[roll.id]}
                  filmType={filmType}
                  filmFormatType={filmFormatType}
                  selected={selectedIds.has(roll.id)}
                  renamingId={renamingId}
                  renameName={renameName}
                  onSetRenamingId={setRenamingId}
                  onSetRenameName={setRenameName}
                  onRename={handleRename}
                  onRollClick={onRollClick}
                  onToggleSelect={toggleSelect}
                  onContextMenu={handleContextMenu}
                  onLocationChanged={onRollLocationChanged}
                />
              ))}
              {photolessCount > 0 && (
                <OtherPhotosCard cardWidth={cardWidth} count={photolessCount} onClick={onOtherPhotosClick} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 框选框 ── */}
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

      {/* ── 右键菜单 ── */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed', left: menuX, top: menuY,
            background: '#1e1e1e', border: '1px solid #2e2e2e',
            borderRadius: 6, boxShadow: '0 4px 20px rgba(0,0,0,0.65)',
            zIndex: 2000, minWidth: 188, padding: '4px 0'
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        >
          {ctxCount === 1 && (
            <CtxItem
              icon={<EditOutlined />}
              label="重命名"
              onClick={() => {
                const roll = rolls.find((r) => r.id === contextMenu.rollIds[0])
                if (roll) { setRenamingId(roll.id); setRenameName(roll.name) }
                setContextMenu(null)
              }}
            />
          )}
          <CtxItem
            icon={<AppstoreOutlined />}
            label={ctxCount > 1 ? `批量修改属性（${ctxCount} 个卷）` : '修改属性'}
            onClick={() => { setBatchAttrOpen(true) }}
          />
          {ctxCount === 1 && (
            <CtxItem
              icon={<DownloadOutlined />}
              label="导出整卷"
              onClick={async () => {
                const rollId = contextMenu.rollIds[0]
                setContextMenu(null)
                const result = await window.api.rolls.photos(rollId, { page: 1, pageSize: 9999, filters: {}, sortBy: 'shot_date', sortOrder: 'asc' }) as { rows: { id: number }[] }
                const photoIds = result.rows.map((p) => p.id)
                if (photoIds.length === 0) { message.warning('该卷没有照片'); return }
                const roll = rolls.find((r) => r.id === rollId)
                openExport(photoIds, `整卷：${roll?.name ?? ''}（${photoIds.length} 张）`)
              }}
            />
          )}
          <div style={{ borderTop: '1px solid #2a2a2a', margin: '4px 0' }} />
          <CtxItem
            icon={<DeleteOutlined />}
            label={ctxCount > 1 ? `删除（${ctxCount} 个卷）` : '删除卷'}
            danger
            onClick={() => {
              openDeleteModal(contextMenu.rollIds)
              setContextMenu(null)
            }}
          />
        </div>
      )}

      {/* ── 删除模态框 ── */}
      <Modal
        open={deleteOpen}
        title={<span style={{ color: '#ccc' }}>
          {deleteIdsRef.current.length > 1 ? `删除 ${deleteIdsRef.current.length} 个卷` : '删除卷'}
        </span>}
        onCancel={() => setDeleteOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setDeleteOpen(false)} style={{ background: '#1a1a1a', borderColor: '#333', color: '#888' }}>取消</Button>,
          <Button key="ok" danger loading={deleting} onClick={handleDelete}>确认删除</Button>
        ]}
        styles={{
          content:  { background: '#1a1a1a', border: '1px solid #333', borderRadius: 8 },
          header:   { background: '#1a1a1a', borderBottom: '1px solid #252525', borderRadius: '8px 8px 0 0' },
          footer:   { background: '#1a1a1a', borderTop: '1px solid #252525', padding: '12px 20px', borderRadius: '0 0 8px 8px' },
          body:     { padding: '16px 20px' }
        }}
      >
        <Radio.Group value={deleteMode} onChange={(e) => setDeleteMode(e.target.value)} style={{ width: '100%' }}>
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <Radio value="roll_only" style={{ color: '#ccc' }}>
              <div>
                <div style={{ fontSize: 13 }}>仅删除索引</div>
                <div style={{ color: '#555', fontSize: 11 }}>卷记录从数据库删除，照片保留（不再归属此卷）</div>
              </div>
            </Radio>
            <Radio value="roll_and_photos" style={{ color: '#ccc' }}>
              <div>
                <div style={{ fontSize: 13 }}>删除卷及数据库中的照片</div>
                <div style={{ color: '#555', fontSize: 11 }}>卷和照片记录一并删除；索引模式照片仅删除记录，不删除原始文件</div>
              </div>
            </Radio>
            <Radio value="roll_and_files" style={{ color: '#ccc' }}>
              <div>
                <div style={{ fontSize: 13 }}>删除卷、照片及物理文件</div>
                <div style={{ color: '#555', fontSize: 11 }}>同时删除图库内照片文件；索引模式照片不会删除原始文件</div>
              </div>
            </Radio>
          </Space>
        </Radio.Group>
      </Modal>

      {/* ── 批量属性编辑模态框 ── */}
      <Modal
        open={batchAttrOpen}
        title={<span style={{ color: '#ccc' }}>批量修改属性（{contextMenu ? contextMenu.rollIds.length : selectedIds.size} 个卷）</span>}
        onCancel={() => { setBatchAttrOpen(false); setBatchAttrs({}) }}
        footer={[
          <Button key="cancel" onClick={() => { setBatchAttrOpen(false); setBatchAttrs({}) }} style={{ background: '#1a1a1a', borderColor: '#333', color: '#888' }}>取消</Button>,
          <Button key="ok" type="primary" onClick={handleBatchSetAttrs} style={{ background: '#c8832a', borderColor: '#c8832a' }}>应用</Button>
        ]}
        styles={{
          content:  { background: '#1a1a1a', border: '1px solid #333', borderRadius: 8 },
          header:   { background: '#1a1a1a', borderBottom: '1px solid #252525', borderRadius: '8px 8px 0 0' },
          footer:   { background: '#1a1a1a', borderTop: '1px solid #252525', padding: '12px 20px', borderRadius: '0 0 8px 8px' },
          body:     { padding: '16px 20px' }
        }}
      >
        <div style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
          选择要批量设置的属性（仅勾选的属性会被覆盖，未选择的保持原值）
        </div>
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          {filmType && (
            <div>
              <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>胶片类型</div>
              <div
                onClick={() => setFilmPickerOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 12px', background: '#222',
                  border: batchAttrs[filmType.id] ? '1px solid #c8832a' : '1px solid #333',
                  borderRadius: 6, cursor: 'pointer'
                }}
              >
                {batchAttrs[filmType.id] ? (
                  <>
                    <FilmTag
                      value={filmValues.find((v) => v.id === batchAttrs[filmType.id])?.value ?? ''}
                      iconKey={filmValues.find((v) => v.id === batchAttrs[filmType.id])?.icon_key}
                      iconSize={24}
                      style={{ color: '#e0e0e0', fontSize: 13, flex: 1 }}
                    />
                    <Button size="small" type="text"
                      onClick={(e) => { e.stopPropagation(); setBatchAttrs((prev) => ({ ...prev, [filmType.id]: null })) }}
                      style={{ color: '#555', padding: 0, minWidth: 'auto' }}
                    >✕</Button>
                  </>
                ) : (
                  <span style={{ color: '#555', fontSize: 13 }}>点击选择胶片类型...</span>
                )}
              </div>
            </div>
          )}
          {attrTypes.filter((t) => t.key !== 'film').map((t) => {
            const values = typeValues[t.id] ?? []
            return (
              <div key={t.id}>
                <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>{t.display_name}</div>
                <Select
                  showSearch style={{ width: '100%' }}
                  placeholder={`选择${t.display_name}...`}
                  value={batchAttrs[t.id] ?? undefined}
                  onChange={(v) => setBatchAttrs((prev) => ({ ...prev, [t.id]: v ?? null }))}
                  allowClear onClear={() => setBatchAttrs((prev) => ({ ...prev, [t.id]: null }))}
                  filterOption={(input, opt) => (String(opt?.label ?? '')).toLowerCase().includes(input.toLowerCase())}
                  options={values.map((v) => ({ value: v.id, label: v.value }))}
                  styles={{ popup: { root: { background: '#1a1a1a' } } }}
                />
              </div>
            )
          })}
        </Space>
      </Modal>

      {/* ── Film picker（批量属性编辑用） ── */}
      <FilmIconPicker
        open={filmPickerOpen}
        filmValues={filmValues}
        selectedValueId={filmTypeId ? (batchAttrs[filmTypeId] ?? null) : null}
        onSelect={(id) => { if (filmTypeId) setBatchAttrs((prev) => ({ ...prev, [filmTypeId]: id })) }}
        onNewValue={(val) => {
          setFilmValues((prev) => [...prev, val])
          if (filmTypeId) {
            setTypeValues((prev) => ({ ...prev, [filmTypeId]: [...(prev[filmTypeId] ?? []), val] }))
            setBatchAttrs((prev) => ({ ...prev, [filmTypeId]: val.id }))
          }
        }}
        onClose={() => setFilmPickerOpen(false)}
      />
    </div>
  )
}

// ── 右键菜单条目 ──────────────────────────────────────────────────────────────
function CtxItem({ icon, label, danger, onClick }: { icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 14px', cursor: 'pointer', fontSize: 13,
        color: danger ? '#ff4d4f' : '#ccc',
        transition: 'background 0.1s'
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#2a2a2a' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
      onClick={onClick}
    >
      <span style={{ fontSize: 14, flexShrink: 0, color: danger ? '#ff4d4f' : '#888' }}>{icon}</span>
      {label}
    </div>
  )
}

// ── 小视图行 ──────────────────────────────────────────────────────────────────
interface SmallRollRowProps {
  roll: Roll
  thumbUrl?: string
  filmType?: AttributeType
  filmFormatType?: AttributeType
  selected: boolean
  renamingId: number | null
  renameName: string
  onSetRenamingId: (id: number | null) => void
  onSetRenameName: (n: string) => void
  onRename: (id: number) => void
  onRollClick: (roll: Roll) => void
  onToggleSelect: (id: number) => void
  onContextMenu: (roll: Roll, x: number, y: number) => void
  onLocationChanged?: () => void
}

function SmallRollRow({
  roll, thumbUrl, filmType, filmFormatType,
  selected, renamingId, renameName,
  onSetRenamingId, onSetRenameName, onRename,
  onRollClick, onToggleSelect, onContextMenu
}: SmallRollRowProps) {
  const isRenaming = renamingId === roll.id
  const filmAttr       = roll.attributes.find((a) => a.key === 'film')
  const filmFormatAttr = roll.attributes.find((a) => a.key === 'film_format')

  return (
    <div
      className="roll-card"
      style={{
        height: SMALL_ROW,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 10px',
        background: selected ? '#1e2a12' : '#1a1a1a',
        borderRadius: 6,
        border: `1px solid ${selected ? '#6aaa3a' : '#242424'}`,
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s'
      }}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = '#c8832a' }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = '#242424' }}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) { onToggleSelect(roll.id); return }
        if (!isRenaming) onRollClick(roll)
      }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(roll, e.clientX, e.clientY) }}
    >
      {/* 封面 */}
      <div style={{ width: 60, height: 60, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {thumbUrl
          ? <img src={thumbUrl} alt={roll.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
          : <PictureOutlined style={{ fontSize: 22, color: '#333' }} />
        }
      </div>

      {/* 信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {isRenaming ? (
          <Input
            autoFocus size="small" value={renameName}
            onChange={(e) => onSetRenameName(e.target.value)}
            onBlur={() => onRename(roll.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRename(roll.id)
              if (e.key === 'Escape') onSetRenamingId(null)
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#333', borderColor: '#c8832a', color: '#ccc', width: '100%' }}
          />
        ) : (
          <div style={{ color: '#ddd', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {roll.name}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'nowrap' }}>
          {filmAttr && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
              {filmAttr.icon_key && <FilmIconImg iconKey={filmAttr.icon_key} size={14} />}
              <span style={{ color: '#aaa', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{filmAttr.value}</span>
            </div>
          )}
          {filmFormatAttr && (
            <Tag style={{ margin: 0, fontSize: 10, padding: '0 4px', background: '#252525', borderColor: '#333', color: '#777', flexShrink: 0 }}>
              {filmFormatAttr.value}
            </Tag>
          )}
        </div>
      </div>

      {/* 右侧：地点 + 张数 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
        {roll.location_name && (
          <span style={{ color: '#666', fontSize: 11 }}>
            <EnvironmentOutlined style={{ marginRight: 2 }} />{roll.location_name}
          </span>
        )}
        <span style={{ color: '#555', fontSize: 11 }}>{roll.photo_count} 张</span>
      </div>
    </div>
  )
}

// ── 中视图卡片 ────────────────────────────────────────────────────────────────
interface RollCardProps {
  roll: Roll
  cardWidth: number
  thumbUrl?: string
  filmType?: AttributeType
  filmFormatType?: AttributeType
  selected: boolean
  renamingId: number | null
  renameName: string
  onSetRenamingId: (id: number | null) => void
  onSetRenameName: (n: string) => void
  onRename: (id: number) => void
  onRollClick: (roll: Roll) => void
  onToggleSelect: (id: number) => void
  onContextMenu: (roll: Roll, x: number, y: number) => void
  onLocationChanged?: () => void
}

function RollCard({
  roll, cardWidth, thumbUrl, filmType, filmFormatType,
  selected, renamingId, renameName,
  onSetRenamingId, onSetRenameName, onRename,
  onRollClick, onToggleSelect, onContextMenu, onLocationChanged
}: RollCardProps) {
  const isRenaming = renamingId === roll.id
  const filmAttr       = roll.attributes.find((a) => a.key === 'film')
  const filmFormatAttr = roll.attributes.find((a) => a.key === 'film_format')
  const [locationPopoverOpen, setLocationPopoverOpen] = useState(false)

  const handleSetLocation = async (loc: Location) => {
    const result = await window.api.rolls.photos(roll.id, { page: 1, pageSize: 9999, filters: {}, sortBy: 'shot_date', sortOrder: 'asc' }) as { rows: { id: number }[] }
    const photoIds = result.rows.map((p) => p.id)
    if (photoIds.length === 0) { setLocationPopoverOpen(false); return }
    await window.api.locations.setForPhotos(photoIds, loc.id)
    setLocationPopoverOpen(false)
    onLocationChanged?.()
  }

  const handleClearLocation = async () => {
    const result = await window.api.rolls.photos(roll.id, { page: 1, pageSize: 9999, filters: {}, sortBy: 'shot_date', sortOrder: 'asc' }) as { rows: { id: number }[] }
    const photoIds = result.rows.map((p) => p.id)
    if (photoIds.length > 0) await window.api.locations.clearForPhotos(photoIds)
    setLocationPopoverOpen(false)
    onLocationChanged?.()
  }

  const locationPopoverContent = (
    <div style={{ width: 280 }} onClick={(e) => e.stopPropagation()}>
      {roll.location_name && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#888', fontSize: 11 }}>当前地点</span>
            <button style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 11, padding: 0 }} onClick={handleClearLocation}>
              <CloseOutlined style={{ marginRight: 2 }} />清除
            </button>
          </div>
          <div style={{ background: '#222', borderRadius: 4, padding: '4px 8px', color: '#ccc', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <EnvironmentOutlined style={{ color: '#c8832a', fontSize: 11 }} />{roll.location_name}
          </div>
          <div style={{ color: '#555', fontSize: 11, marginTop: 6, marginBottom: 4 }}>更换地点</div>
        </div>
      )}
      <LocationPicker onSelect={handleSetLocation} placeholder="搜索并设置地点..." />
    </div>
  )

  return (
    <div
      className="roll-card"
      style={{
        width: cardWidth,
        background: selected ? '#1e2a12' : '#1e1e1e',
        borderRadius: 8, overflow: 'hidden',
        border: `1px solid ${selected ? '#6aaa3a' : '#2a2a2a'}`,
        cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s', flexShrink: 0
      }}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = '#c8832a' }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = selected ? '#6aaa3a' : '#2a2a2a' }}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) { onToggleSelect(roll.id); return }
        if (!isRenaming) onRollClick(roll)
      }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(roll, e.clientX, e.clientY) }}
    >
      {/* 封面图 */}
      <div style={{ width: '100%', height: COVER_H_MEDIUM, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
        {thumbUrl
          ? <img src={thumbUrl} alt={roll.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
          : <PictureOutlined style={{ fontSize: 36, color: '#333' }} />
        }
        <div style={{ position: 'absolute', bottom: 6, right: 8, background: 'rgba(0,0,0,0.65)', color: '#ccc', fontSize: 11, padding: '2px 6px', borderRadius: 10, backdropFilter: 'blur(4px)' }}>
          {roll.photo_count} 张
        </div>
      </div>

      {/* 信息区 */}
      <div style={{ padding: '8px 10px' }} onClick={(e) => e.stopPropagation()}>
        {isRenaming ? (
          <Input autoFocus size="small" value={renameName}
            onChange={(e) => onSetRenameName(e.target.value)}
            onBlur={() => onRename(roll.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRename(roll.id)
              if (e.key === 'Escape') onSetRenamingId(null)
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#333', borderColor: '#c8832a', color: '#ccc', width: '100%', marginBottom: 4 }}
          />
        ) : (
          <div style={{ color: '#ddd', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4, cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onRollClick(roll) }}>
            {roll.name}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', minHeight: 20 }}>
          {filmAttr && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              {filmAttr.icon_key && <FilmIconImg iconKey={filmAttr.icon_key} size={16} />}
              <span style={{ color: '#aaa', fontSize: 11, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filmAttr.value}</span>
            </div>
          )}
          {filmFormatAttr && (
            <Tag style={{ margin: 0, fontSize: 10, padding: '0 4px', background: '#252525', borderColor: '#333', color: '#888' }}>
              {filmFormatAttr.value}
            </Tag>
          )}
        </div>
        {roll.location_name && (
          <div style={{ color: '#666', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3 }}>
            <EnvironmentOutlined style={{ marginRight: 2 }} />{roll.location_name}
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, marginTop: 6, justifyContent: 'flex-end' }}>
          <Popover
            content={locationPopoverContent}
            title={<span style={{ color: '#aaa', fontSize: 12 }}>设置拍摄地点</span>}
            trigger="click" open={locationPopoverOpen} onOpenChange={(v) => setLocationPopoverOpen(v)}
            overlayStyle={{ zIndex: 2000 }}
            overlayInnerStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }}
          >
            <Tooltip title="设置地点">
              <button style={{ background: 'transparent', border: 'none', color: roll.location_name ? '#c8832a' : '#555', cursor: 'pointer', padding: '2px 4px', fontSize: 12 }}
                onClick={(e) => e.stopPropagation()}>
                <EnvironmentOutlined />
              </button>
            </Tooltip>
          </Popover>
          <Tooltip title="重命名">
            <button style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: '2px 4px', fontSize: 12 }}
              onClick={(e) => { e.stopPropagation(); onSetRenamingId(roll.id); onSetRenameName(roll.name) }}>
              <EditOutlined />
            </button>
          </Tooltip>
          <Tooltip title="删除卷">
            <button style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: '2px 4px', fontSize: 12 }}
              onClick={(e) => { e.stopPropagation(); onContextMenu(roll, e.clientX, e.clientY) }}>
              <DeleteOutlined />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

// ── 大视图横向详情行（方案 A）────────────────────────────────────────────────
interface LargeRollRowProps {
  roll: Roll
  rowWidth: number
  thumbUrl?: string
  filmType?: AttributeType
  filmFormatType?: AttributeType
  selected: boolean
  renamingId: number | null
  renameName: string
  onSetRenamingId: (id: number | null) => void
  onSetRenameName: (n: string) => void
  onRename: (id: number) => void
  onRollClick: (roll: Roll) => void
  onToggleSelect: (id: number) => void
  onContextMenu: (roll: Roll, x: number, y: number) => void
  onLocationChanged?: () => void
}

function LargeRollRow({
  roll, rowWidth, thumbUrl, filmType, filmFormatType,
  selected, renamingId, renameName,
  onSetRenamingId, onSetRenameName, onRename,
  onRollClick, onToggleSelect, onContextMenu, onLocationChanged
}: LargeRollRowProps) {
  const isRenaming     = renamingId === roll.id
  const filmAttr       = roll.attributes.find((a) => a.key === 'film')
  const filmFormatAttr = roll.attributes.find((a) => a.key === 'film_format')
  const cameraAttr     = roll.attributes.find((a) => a.key === 'camera')
  const lensAttr       = roll.attributes.find((a) => a.key === 'lens')
  const [locationPopoverOpen, setLocationPopoverOpen] = useState(false)

  const shotDateDisplay = roll.shot_date_min ? String(roll.shot_date_min).slice(0, 7) : null

  const handleSetLocation = async (loc: Location) => {
    const result = await window.api.rolls.photos(roll.id, { page: 1, pageSize: 9999, filters: {}, sortBy: 'shot_date', sortOrder: 'asc' }) as { rows: { id: number }[] }
    const photoIds = result.rows.map((p) => p.id)
    if (photoIds.length === 0) { setLocationPopoverOpen(false); return }
    await window.api.locations.setForPhotos(photoIds, loc.id)
    setLocationPopoverOpen(false)
    onLocationChanged?.()
  }

  const handleClearLocation = async () => {
    const result = await window.api.rolls.photos(roll.id, { page: 1, pageSize: 9999, filters: {}, sortBy: 'shot_date', sortOrder: 'asc' }) as { rows: { id: number }[] }
    const photoIds = result.rows.map((p) => p.id)
    if (photoIds.length > 0) await window.api.locations.clearForPhotos(photoIds)
    setLocationPopoverOpen(false)
    onLocationChanged?.()
  }

  const locationPopoverContent = (
    <div style={{ width: 280 }} onClick={(e) => e.stopPropagation()}>
      {roll.location_name && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#888', fontSize: 11 }}>当前地点</span>
            <button style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 11, padding: 0 }} onClick={handleClearLocation}>
              <CloseOutlined style={{ marginRight: 2 }} />清除
            </button>
          </div>
          <div style={{ background: '#222', borderRadius: 4, padding: '4px 8px', color: '#ccc', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <EnvironmentOutlined style={{ color: '#c8832a', fontSize: 11 }} />{roll.location_name}
          </div>
          <div style={{ color: '#555', fontSize: 11, marginTop: 6, marginBottom: 4 }}>更换地点</div>
        </div>
      )}
      <LocationPicker onSelect={handleSetLocation} placeholder="搜索并设置地点..." />
    </div>
  )

  // 封面占 55% 宽度，信息区占 45%
  const coverW = Math.round(rowWidth * 0.55)

  return (
    <div
      className="roll-card"
      style={{
        width: rowWidth, height: LARGE_ROW_H,
        display: 'flex', flexDirection: 'row',
        background: selected ? '#1e2a12' : '#1e1e1e',
        borderRadius: 8, overflow: 'hidden',
        border: `1px solid ${selected ? '#6aaa3a' : '#2a2a2a'}`,
        cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s'
      }}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = '#c8832a' }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = selected ? '#6aaa3a' : '#2a2a2a' }}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) { onToggleSelect(roll.id); return }
        if (!isRenaming) onRollClick(roll)
      }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(roll, e.clientX, e.clientY) }}
    >
      {/* 左侧：封面图（55%）*/}
      <div style={{ width: coverW, flexShrink: 0, background: '#111', overflow: 'hidden', position: 'relative' }}>
        {thumbUrl
          ? <img src={thumbUrl} alt={roll.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PictureOutlined style={{ fontSize: 48, color: '#333' }} />
            </div>
        }
        {/* 张数角标 */}
        <div style={{ position: 'absolute', bottom: 8, right: 10, background: 'rgba(0,0,0,0.65)', color: '#ccc', fontSize: 12, padding: '2px 8px', borderRadius: 10, backdropFilter: 'blur(4px)' }}>
          {roll.photo_count} 张
        </div>
      </div>

      {/* 右侧：信息区（45%）*/}
      <div
        style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '16px 16px 12px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 上半：卷名 + 属性 */}
        <div>
          {/* 卷名 */}
          {isRenaming ? (
            <Input autoFocus value={renameName}
              onChange={(e) => onSetRenameName(e.target.value)}
              onBlur={() => onRename(roll.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRename(roll.id)
                if (e.key === 'Escape') onSetRenamingId(null)
              }}
              onClick={(e) => e.stopPropagation()}
              style={{ background: '#333', borderColor: '#c8832a', color: '#ccc', width: '100%', marginBottom: 10, fontSize: 15 }}
            />
          ) : (
            <div
              style={{ color: '#e0e0e0', fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 10, lineHeight: '1.3' }}
              onClick={(e) => { e.stopPropagation(); onRollClick(roll) }}
            >
              {roll.name}
            </div>
          )}

          {/* 胶片 + 格式 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {filmAttr && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {filmAttr.icon_key && <FilmIconImg iconKey={filmAttr.icon_key} size={18} />}
                <span style={{ color: '#bbb', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{filmAttr.value}</span>
              </div>
            )}
            {filmFormatAttr && (
              <Tag style={{ margin: 0, fontSize: 11, padding: '0 6px', background: '#252525', borderColor: '#333', color: '#888' }}>
                {filmFormatAttr.value}
              </Tag>
            )}
          </div>

          {/* 相机 + 镜头 */}
          {(cameraAttr || lensAttr) && (
            <div style={{ color: '#888', fontSize: 12, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cameraAttr && <span>📷 {cameraAttr.value}</span>}
              {cameraAttr && lensAttr && <span style={{ color: '#555', margin: '0 6px' }}>·</span>}
              {lensAttr && <span>🔭 {lensAttr.value}</span>}
            </div>
          )}

          {/* 地点 */}
          {roll.location_name && (
            <div style={{ color: '#777', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
              <EnvironmentOutlined style={{ marginRight: 4, color: '#c8832a' }} />{roll.location_name}
            </div>
          )}

          {/* 日期 */}
          {shotDateDisplay && (
            <div style={{ color: '#666', fontSize: 12 }}>{shotDateDisplay}</div>
          )}
        </div>

        {/* 下半：操作按钮 */}
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
          <Popover
            content={locationPopoverContent}
            title={<span style={{ color: '#aaa', fontSize: 12 }}>设置拍摄地点</span>}
            trigger="click" open={locationPopoverOpen} onOpenChange={(v) => setLocationPopoverOpen(v)}
            overlayStyle={{ zIndex: 2000 }}
            overlayInnerStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }}
          >
            <Tooltip title="设置地点">
              <button style={{ background: 'transparent', border: 'none', color: roll.location_name ? '#c8832a' : '#555', cursor: 'pointer', padding: '3px 5px', fontSize: 13 }}
                onClick={(e) => e.stopPropagation()}>
                <EnvironmentOutlined />
              </button>
            </Tooltip>
          </Popover>
          <Tooltip title="重命名">
            <button style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: '3px 5px', fontSize: 13 }}
              onClick={(e) => { e.stopPropagation(); onSetRenamingId(roll.id); onSetRenameName(roll.name) }}>
              <EditOutlined />
            </button>
          </Tooltip>
          <Tooltip title="删除卷">
            <button style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: '3px 5px', fontSize: 13 }}
              onClick={(e) => { e.stopPropagation(); onContextMenu(roll, e.clientX, e.clientY) }}>
              <DeleteOutlined />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

// ── 其他图片卡片（小视图） ─────────────────────────────────────────────────────
function OtherPhotosSmallRow({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <div
      style={{
        height: SMALL_ROW, display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px',
        background: '#141414', borderRadius: 6, border: '1px dashed #2a2a2a', cursor: 'pointer',
        transition: 'border-color 0.15s'
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#555' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#2a2a2a' }}
      onClick={onClick}
    >
      <div style={{ width: 60, height: 60, flexShrink: 0, borderRadius: 4, background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <PictureOutlined style={{ fontSize: 22, color: '#444' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#888', fontSize: 13, fontWeight: 500 }}>其他图片</div>
        <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>{count} 张未分卷</div>
      </div>
    </div>
  )
}

// ── 其他图片卡片（中视图） ─────────────────────────────────────────────────────
function OtherPhotosCard({ cardWidth, count, onClick }: { cardWidth: number; count: number; onClick: () => void }) {
  return (
    <div
      style={{
        width: cardWidth, background: '#1a1a1a', borderRadius: 8, overflow: 'hidden',
        border: '1px dashed #333', cursor: 'pointer', transition: 'border-color 0.15s'
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#666' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#333' }}
      onClick={onClick}
    >
      <div style={{ width: '100%', height: COVER_H_MEDIUM, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <PictureOutlined style={{ fontSize: 36, color: '#444' }} />
        <div style={{ color: '#555', fontSize: 12 }}>未分卷照片</div>
      </div>
      <div style={{ padding: '8px 10px' }}>
        <div style={{ color: '#888', fontSize: 13, fontWeight: 500 }}>其他图片</div>
        <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>{count} 张未分卷</div>
      </div>
    </div>
  )
}

// ── 其他图片横行（大视图） ─────────────────────────────────────────────────────
function OtherPhotosLargeRow({ rowWidth, count, onClick }: { rowWidth: number; count: number; onClick: () => void }) {
  const coverW = Math.round(rowWidth * 0.55)
  return (
    <div
      style={{
        width: rowWidth, height: LARGE_ROW_H, display: 'flex', flexDirection: 'row',
        background: '#1a1a1a', borderRadius: 8, overflow: 'hidden',
        border: '1px dashed #333', cursor: 'pointer', transition: 'border-color 0.15s'
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#666' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#333' }}
      onClick={onClick}
    >
      <div style={{ width: coverW, flexShrink: 0, background: '#141414', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <PictureOutlined style={{ fontSize: 48, color: '#444' }} />
        <div style={{ color: '#555', fontSize: 13 }}>未分卷照片</div>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '16px 16px' }}>
        <div style={{ color: '#888', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>其他图片</div>
        <div style={{ color: '#666', fontSize: 13 }}>{count} 张未分卷</div>
      </div>
    </div>
  )
}
