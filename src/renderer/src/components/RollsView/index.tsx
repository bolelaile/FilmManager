import React, { useRef, useEffect, useState } from 'react'
import { Spin, Empty, Tooltip, Tag, Popconfirm, message, Popover } from 'antd'
import { DeleteOutlined, EditOutlined, EnvironmentOutlined, PictureOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons'
import type { Roll, AttributeType, Location } from '../../types'
import { FilmIconImg } from '../FilmIcon'
import LocationPicker from '../LocationPicker'

const WIDE_THRESHOLD = 1400
const COLS = { normal: 4, wide: 6 }
const CARD_HEIGHT = 220
const COL_GAP = 16
const ROW_GAP = 16

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

export default function RollsView({
  rolls, photolessCount, loading, attrTypes,
  onRollClick, onOtherPhotosClick, onRollDeleted, onRollRenamed, onRollLocationChanged
}: RollsViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [thumbCache, setThumbCache] = useState<Record<number, string>>({})
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameName, setRenameName] = useState('')

  const filmType = attrTypes.find((t) => t.key === 'film')
  const filmFormatType = attrTypes.find((t) => t.key === 'film_format')

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // Load thumbnails for roll covers
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

  const cols = containerWidth >= WIDE_THRESHOLD ? COLS.wide : COLS.normal
  const cardWidth = containerWidth > 0
    ? Math.floor((containerWidth - COL_GAP * (cols - 1)) / cols)
    : 200

  const handleRename = async (id: number) => {
    if (!renameName.trim()) { setRenamingId(null); return }
    await window.api.rolls.rename(id, renameName.trim())
    setRenamingId(null)
    onRollRenamed()
  }

  const handleDelete = async (id: number) => {
    await window.api.rolls.delete(id)
    message.success('已删除卷')
    onRollDeleted()
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (rolls.length === 0 && photolessCount === 0) {
    return (
      <Empty
        description={<span style={{ color: '#555' }}>暂无卷，请选择照片后创建</span>}
        style={{ paddingTop: 80 }}
      />
    )
  }

  return (
    <div
      ref={containerRef}
      style={{ padding: '16px 20px', overflowY: 'auto', height: '100%' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, ${cardWidth}px)`,
          gap: `${ROW_GAP}px ${COL_GAP}px`
        }}
      >
        {rolls.map((roll) => (
          <RollCard
            key={roll.id}
            roll={roll}
            cardWidth={cardWidth}
            thumbUrl={thumbCache[roll.id]}
            filmType={filmType}
            filmFormatType={filmFormatType}
            renamingId={renamingId}
            renameName={renameName}
            onSetRenamingId={setRenamingId}
            onSetRenameName={setRenameName}
            onRollClick={onRollClick}
            onRename={handleRename}
            onDelete={handleDelete}
            onLocationChanged={onRollLocationChanged}
          />
        ))}

        {/* 其他图片卡片 */}
        {photolessCount > 0 && (
          <OtherPhotosCard
            count={photolessCount}
            cardWidth={cardWidth}
            onClick={onOtherPhotosClick}
          />
        )}
      </div>
    </div>
  )
}

interface RollCardProps {
  roll: Roll
  cardWidth: number
  thumbUrl?: string
  filmType?: AttributeType
  filmFormatType?: AttributeType
  renamingId: number | null
  renameName: string
  onSetRenamingId: (id: number | null) => void
  onSetRenameName: (n: string) => void
  onRollClick: (roll: Roll) => void
  onRename: (id: number) => void
  onDelete: (id: number) => void
  onLocationChanged?: () => void
}

function RollCard({
  roll, cardWidth, thumbUrl, filmType, filmFormatType,
  renamingId, renameName, onSetRenamingId, onSetRenameName,
  onRollClick, onRename, onDelete, onLocationChanged
}: RollCardProps) {
  const filmAttr = roll.attributes.find((a) => a.key === 'film')
  const filmFormatAttr = roll.attributes.find((a) => a.key === 'film_format')
  const isRenaming = renamingId === roll.id
  const [locationPopoverOpen, setLocationPopoverOpen] = useState(false)

  const imgHeight = CARD_HEIGHT - 72

  const handleSetLocation = async (loc: Location) => {
    // Get photo IDs for this roll
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
            <button
              style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 11, padding: 0 }}
              onClick={handleClearLocation}
            >
              <CloseOutlined style={{ marginRight: 2 }} />清除
            </button>
          </div>
          <div style={{ background: '#222', borderRadius: 4, padding: '4px 8px', color: '#ccc', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <EnvironmentOutlined style={{ color: '#c8832a', fontSize: 11 }} />
            {roll.location_name}
          </div>
          <div style={{ color: '#555', fontSize: 11, marginTop: 6, marginBottom: 4 }}>更换地点</div>
        </div>
      )}
      <LocationPicker onSelect={handleSetLocation} placeholder="搜索并设置地点..." />
    </div>
  )

  return (
    <div
      style={{
        width: cardWidth,
        background: '#1e1e1e',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid #2a2a2a',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        flexShrink: 0
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#c8832a' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#2a2a2a' }}
      onClick={() => !isRenaming && onRollClick(roll)}
    >
      {/* Cover image */}
      <div
        style={{
          width: '100%',
          height: imgHeight,
          background: '#111',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={roll.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            draggable={false}
          />
        ) : (
          <PictureOutlined style={{ fontSize: 36, color: '#333' }} />
        )}
        {/* Photo count badge */}
        <div style={{
          position: 'absolute',
          bottom: 6,
          right: 8,
          background: 'rgba(0,0,0,0.65)',
          color: '#ccc',
          fontSize: 11,
          padding: '2px 6px',
          borderRadius: 10,
          backdropFilter: 'blur(4px)'
        }}>
          {roll.photo_count} 张
        </div>
      </div>

      {/* Info section */}
      <div
        style={{ padding: '8px 10px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Roll name (editable) */}
        {isRenaming ? (
          <input
            autoFocus
            value={renameName}
            onChange={(e) => onSetRenameName(e.target.value)}
            onBlur={() => onRename(roll.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRename(roll.id)
              if (e.key === 'Escape') onSetRenamingId(null)
            }}
            style={{
              width: '100%',
              background: '#333',
              border: '1px solid #c8832a',
              borderRadius: 4,
              color: '#ccc',
              fontSize: 13,
              padding: '2px 6px',
              outline: 'none',
              marginBottom: 4
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            style={{
              color: '#ddd',
              fontSize: 13,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginBottom: 4,
              cursor: 'pointer'
            }}
            onClick={(e) => { e.stopPropagation(); onRollClick(roll) }}
          >
            {roll.name}
          </div>
        )}

        {/* Attributes row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', minHeight: 20 }}>
          {filmAttr && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              {filmAttr.icon_key && (
                <FilmIconImg iconKey={filmAttr.icon_key} size={16} />
              )}
              <span style={{ color: '#aaa', fontSize: 11, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {filmAttr.value}
              </span>
            </div>
          )}
          {filmFormatAttr && (
            <Tag style={{ margin: 0, fontSize: 10, padding: '0 4px', background: '#252525', borderColor: '#333', color: '#888' }}>
              {filmFormatAttr.value}
            </Tag>
          )}
          {roll.location_name && (
            <span style={{ color: '#666', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>
              <EnvironmentOutlined style={{ marginRight: 2 }} />{roll.location_name}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div
          style={{ display: 'flex', gap: 4, marginTop: 6, justifyContent: 'flex-end' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Popover
            content={locationPopoverContent}
            title={<span style={{ color: '#aaa', fontSize: 12 }}>设置拍摄地点</span>}
            trigger="click"
            open={locationPopoverOpen}
            onOpenChange={(v) => setLocationPopoverOpen(v)}
            overlayStyle={{ zIndex: 2000 }}
            overlayInnerStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }}
          >
            <Tooltip title="设置地点">
              <button
                style={{ background: 'transparent', border: 'none', color: roll.location_name ? '#c8832a' : '#555', cursor: 'pointer', padding: '2px 4px', fontSize: 12 }}
                onClick={(e) => e.stopPropagation()}
              >
                <EnvironmentOutlined />
              </button>
            </Tooltip>
          </Popover>
          <Tooltip title="重命名">
            <button
              style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: '2px 4px', fontSize: 12 }}
              onClick={(e) => { e.stopPropagation(); onSetRenamingId(roll.id); onSetRenameName(roll.name) }}
            >
              <EditOutlined />
            </button>
          </Tooltip>
          <Popconfirm
            title="删除此卷？照片不会被删除。"
            onConfirm={(e) => { e?.stopPropagation(); onDelete(roll.id) }}
            okText="删除"
            cancelText="取消"
          >
            <Tooltip title="删除卷">
              <button
                style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: '2px 4px', fontSize: 12 }}
                onClick={(e) => e.stopPropagation()}
              >
                <DeleteOutlined />
              </button>
            </Tooltip>
          </Popconfirm>
        </div>
      </div>
    </div>
  )
}

function OtherPhotosCard({ count, cardWidth, onClick }: { count: number; cardWidth: number; onClick: () => void }) {
  const imgHeight = CARD_HEIGHT - 72
  return (
    <div
      style={{
        width: cardWidth,
        background: '#1a1a1a',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px dashed #333',
        cursor: 'pointer',
        transition: 'border-color 0.15s'
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#666' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#333' }}
      onClick={onClick}
    >
      <div
        style={{
          width: '100%',
          height: imgHeight,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8
        }}
      >
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
