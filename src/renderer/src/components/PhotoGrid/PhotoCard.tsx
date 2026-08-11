import React, { useEffect, useState, memo } from 'react'
import { Tooltip } from 'antd'
import { FileImageOutlined, CheckCircleFilled, LoadingOutlined } from '@ant-design/icons'
import type { Photo, AttributeType } from '../../types'
import { FilmIconImg } from '../FilmIcon'

interface PhotoCardProps {
  photo: Photo
  size: number
  infoBarHeight: number
  selected: boolean
  viewMode: 'small' | 'medium' | 'large'
  attrTypes: AttributeType[]
  onSelect: () => void
  onDoubleClick: () => void
  onContextMenu: (photo: Photo, x: number, y: number) => void
  onHover?: (photo: Photo) => void
}

// ── 小视图：横向列表卡片 ─────────────────────────────────────────────
function SmallCard({
  photo,
  size,
  selected,
  attrTypes,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onHover
}: PhotoCardProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)

  useEffect(() => {
    if (photo.thumb_path && photo.thumb_ready) {
      setThumbUrl(`localfile://${encodeURIComponent(photo.thumb_path)}`)
    } else {
      // 缩略图缺失时自动尝试重新生成（主要针对 BMP 等之前无法生成缩略图的格式）
      window.api.library.regenThumb(photo.id).then((thumbPath) => {
        if (thumbPath && typeof thumbPath === 'string') {
          setThumbUrl(`localfile://${encodeURIComponent(thumbPath)}`)
        }
      }).catch(() => {})
    }
  }, [photo.id, photo.thumb_path, photo.thumb_ready])

  const isRaw = !['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'webp'].includes(
    photo.file_type.toLowerCase()
  )

  // 展示所有激活的属性类别（排除 imported_at）
  const displayTypes = attrTypes.filter((t) => t.is_active && t.key !== 'imported_at')

  // 导入中占位态
  if (photo.import_status === 'indexing') {
    return (
      <div
        className="photo-card"
        style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10,
          background: '#181818', border: '1px solid #1e1e1e', borderRadius: 6,
          padding: '5px 10px 5px 5px', boxSizing: 'border-box', cursor: 'default'
        }}
      >
        <div style={{
          width: size, height: size, flexShrink: 0, borderRadius: 4,
          background: 'linear-gradient(90deg,#1e1e1e 25%,#252525 50%,#1e1e1e 75%)',
          backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <LoadingOutlined style={{ color: '#333', fontSize: 14 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#444', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {photo.original_name}
          </div>
          <div style={{ color: '#333', fontSize: 11, marginTop: 2 }}>正在导入...</div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="photo-card"
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        background: selected ? 'rgba(200,131,42,0.08)' : '#181818',
        border: selected ? '1px solid #c8832a' : '1px solid #232323',
        borderRadius: 6,
        padding: '5px 10px 5px 5px',
        transition: 'border-color 0.15s, background 0.15s',
        boxSizing: 'border-box'
      }}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => onHover?.(photo)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(photo, e.clientX, e.clientY) }}
    >
      {/* 缩略图 */}
      <div style={{
        width: size, height: size, flexShrink: 0,
        borderRadius: 4, overflow: 'hidden', background: '#111',
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={photo.original_name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div style={{ textAlign: 'center', color: '#444' }}>
            <FileImageOutlined style={{ fontSize: 20 }} />
            <div style={{ fontSize: 9, marginTop: 2 }}>{photo.file_type.toUpperCase()}</div>
          </div>
        )}
        {isRaw && (
          <div style={{
            position: 'absolute', bottom: 2, left: 2,
            background: '#8B4E19', borderRadius: 2,
            fontSize: 8, padding: '0 3px', color: '#fff', lineHeight: '14px'
          }}>RAW</div>
        )}
        {selected && (
          <CheckCircleFilled style={{
            position: 'absolute', top: 2, right: 2,
            color: '#c8832a', fontSize: 14,
            filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.8))'
          }} />
        )}
      </div>

      {/* 右侧信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 文件名行 */}
        <Tooltip title={photo.original_name}>
          <div style={{
            color: '#ddd', fontSize: 12, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginBottom: 4
          }}>
            {photo.original_name}
          </div>
        </Tooltip>
        {/* 属性行：类型: 值 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 16, rowGap: 2 }}>
          {displayTypes.map((t) => {
            const attr = photo.attributes?.find((a) => a.key === t.key)
            const isFilm = t.key === 'film'
            const iconKey = isFilm && attr ? (attr as any).icon_key : null
            return (
              <div key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
                <span style={{ color: '#777', fontSize: 11, flexShrink: 0 }}>{t.display_name}:</span>
                {isFilm && iconKey && <FilmIconImg iconKey={iconKey} size={11} />}
                <span style={{
                  color: attr ? '#bbb' : '#555',
                  fontSize: 11, fontStyle: attr ? 'normal' : 'italic',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  maxWidth: 160
                }}>
                  {attr ? attr.value : '其他'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── 中/大视图：方块缩略图卡片 ────────────────────────────────────────
function TileCard({
  photo,
  size,
  infoBarHeight,
  selected,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onHover
}: PhotoCardProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (photo.thumb_path && photo.thumb_ready) {
      setThumbUrl(`localfile://${encodeURIComponent(photo.thumb_path)}`)
      setLoading(false)
    } else {
      // 缩略图缺失时自动尝试重新生成
      window.api.library.regenThumb(photo.id).then((thumbPath) => {
        if (thumbPath && typeof thumbPath === 'string') {
          setThumbUrl(`localfile://${encodeURIComponent(thumbPath)}`)
        }
        setLoading(false)
      }).catch(() => { setLoading(false) })
    }
  }, [photo.id, photo.thumb_path, photo.thumb_ready])

  const cameraAttr = photo.attributes?.find((a) => a.key === 'camera')
  const filmAttr = photo.attributes?.find((a) => a.key === 'film')
  const isRaw = !['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'webp'].includes(
    photo.file_type.toLowerCase()
  )
  const fontSize = size < 170 ? 10 : 11

  return (
    <div
      className="photo-card"
      style={{ width: size, flexShrink: 0, cursor: 'pointer', position: 'relative' }}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => onHover?.(photo)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(photo, e.clientX, e.clientY)
      }}
    >
      <div style={{
        width: size, height: size,
        background: '#1e1e1e', borderRadius: 6, overflow: 'hidden',
        border: selected ? '2px solid #c8832a' : '2px solid transparent',
        transition: 'border-color 0.15s',
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={photo.original_name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: loading ? 'none' : 'block' }}
            onLoad={() => setLoading(false)}
            onError={() => setLoading(false)}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div style={{ textAlign: 'center', color: '#444' }}>
            <FileImageOutlined style={{ fontSize: 32 }} />
            <div style={{ fontSize: 11, marginTop: 4 }}>{photo.file_type.toUpperCase()}</div>
          </div>
        )}

        {isRaw && (
          <div style={{
            position: 'absolute', top: 4, left: 4,
            background: '#8B4E19', borderRadius: 3,
            fontSize: 9, padding: '0 4px', color: '#fff', lineHeight: '16px'
          }}>RAW</div>
        )}
        {selected && (
          <CheckCircleFilled style={{
            position: 'absolute', top: 4, right: 4,
            color: '#c8832a', fontSize: 18,
            filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.8))'
          }} />
        )}
      </div>

      <div style={{ padding: '4px 2px 0', height: infoBarHeight, overflow: 'hidden' }}>
        <Tooltip title={photo.original_name}>
          <div style={{
            color: '#ccc', fontSize,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            lineHeight: '18px'
          }}>
            {photo.original_name}
          </div>
        </Tooltip>
        {infoBarHeight >= 44 && (
          <div style={{
            color: '#666', fontSize: fontSize - 1, lineHeight: '16px',
            display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden'
          }}>
            {cameraAttr && (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: size * 0.55 }}>
                {cameraAttr.value}
              </span>
            )}
            {filmAttr && (
              <span style={{ color: '#8B7355', display: 'inline-flex', alignItems: 'center', gap: 3, overflow: 'hidden' }}>
                {(filmAttr as any).icon_key && (
                  <FilmIconImg iconKey={(filmAttr as any).icon_key} size={12} />
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: size * 0.5 }}>
                  {filmAttr.value}
                </span>
              </span>
            )}
            {!cameraAttr && !filmAttr && (
              <span>{photo.imported_at.substring(0, 10)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 统一导出 ─────────────────────────────────────────────────────────
const PhotoCard = memo(function PhotoCard(props: PhotoCardProps) {
  if (props.viewMode === 'small') return <SmallCard {...props} />
  return <TileCard {...props} />
})

export default PhotoCard
