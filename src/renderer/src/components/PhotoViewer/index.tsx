import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Spin, Button, Select, Divider, DatePicker, Input, message, Modal, Tooltip } from 'antd'
import { FolderOpenOutlined, PlusOutlined, PictureOutlined, RotateRightOutlined } from '@ant-design/icons'
import { useStore } from '../../store'
import type { Photo, IccProfile, AttributeType, AttributeValue } from '../../types'
import { FilmTag, FilmIconPicker } from '../FilmIcon'
import dayjs from 'dayjs'

// ─── Histogram ────────────────────────────────────────────────────────────────

function computeHistogram(img: HTMLImageElement): { r: number[]; g: number[]; b: number[] } {
  const canvas = document.createElement('canvas')
  const maxDim = 240
  const aspect = img.naturalWidth / img.naturalHeight
  if (aspect >= 1) {
    canvas.width = maxDim
    canvas.height = Math.round(maxDim / aspect)
  } else {
    canvas.height = maxDim
    canvas.width = Math.round(maxDim * aspect)
  }
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const r = new Array(256).fill(0)
  const g = new Array(256).fill(0)
  const b = new Array(256).fill(0)
  for (let i = 0; i < data.length; i += 4) {
    r[data[i]]++
    g[data[i + 1]]++
    b[data[i + 2]]++
  }
  return { r, g, b }
}

function HistogramCanvas({ data }: { data: { r: number[]; g: number[]; b: number[] } | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0e0e0e'
    ctx.fillRect(0, 0, W, H)
    if (!data) return
    const maxVal = Math.max(...data.r.slice(1, 255), ...data.g.slice(1, 255), ...data.b.slice(1, 255))
    if (maxVal === 0) return
    const binW = W / 256
    const drawCh = (vals: number[], color: string) => {
      ctx.globalCompositeOperation = 'screen'
      ctx.fillStyle = color
      for (let i = 0; i < 256; i++) {
        const bh = Math.round((vals[i] / maxVal) * H)
        ctx.fillRect(i * binW, H - bh, binW + 0.5, bh)
      }
    }
    drawCh(data.r, '#cc3333')
    drawCh(data.g, '#33aa44')
    drawCh(data.b, '#3366dd')
    ctx.globalCompositeOperation = 'source-over'
  }, [data])
  return (
    <canvas ref={ref} width={256} height={96} style={{ width: '100%', height: 96, borderRadius: 4, display: 'block' }} />
  )
}

// ─── Attribute editor (inline in side panel) ──────────────────────────────────

// normalize: collapse spaces and lowercase but KEEP non-ASCII (Chinese, etc.)
const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase()

interface AttrEditorProps {
  photo: Photo
  attrTypes: AttributeType[]
  onChanged: () => void
}

function AttrEditor({ photo, attrTypes, onChanged }: AttrEditorProps) {
  const [filmValues, setFilmValues] = useState<AttributeValue[]>([])
  const [filmTypeId, setFilmTypeId] = useState<number | null>(null)
  const [filmPickerOpen, setFilmPickerOpen] = useState(false)
  // per-type extra values created inline
  const [extraValues, setExtraValues] = useState<Record<number, AttributeValue[]>>({})
  // per-type search text for inline-create
  const [searchTexts, setSearchTexts] = useState<Record<number, string>>({})

  useEffect(() => {
    const filmType = attrTypes.find((t) => t.key === 'film')
    if (filmType) {
      setFilmTypeId(filmType.id)
      window.api.attrs.listValues(filmType.id).then((vals) => setFilmValues(vals as AttributeValue[]))
    }
  }, [attrTypes])

  const handleAttrChange = async (typeId: number, valueId: number | null) => {
    const existing = photo.attributes.filter((a) => a.attribute_type_id !== typeId)
    const newAttrs = valueId
      ? [...existing.map((a) => ({ typeId: a.attribute_type_id, valueId: a.value_id })), { typeId, valueId }]
      : existing.map((a) => ({ typeId: a.attribute_type_id, valueId: a.value_id }))
    await window.api.photos.setAttributes(photo.id, newAttrs)
    onChanged()
  }

  const handleCreateAndSelect = async (typeId: number, name: string) => {
    if (!name.trim()) return
    const newId = await window.api.attrs.addValue(typeId, name.trim()) as number
    const newVal: AttributeValue = { id: newId, attribute_type_id: typeId, value: name.trim(), is_preset: 0 }
    setExtraValues((prev) => ({ ...prev, [typeId]: [...(prev[typeId] ?? []), newVal] }))
    if (typeId === filmTypeId) setFilmValues((prev) => [...prev, newVal])
    await handleAttrChange(typeId, newId)
    setSearchTexts((prev) => ({ ...prev, [typeId]: '' }))
  }

  const visibleTypes = attrTypes.filter((t) => t.is_active && t.key !== 'imported_at')

  return (
    <>
      {visibleTypes.map((type) => {
        const currentAttr = photo.attributes.find((a) => a.attribute_type_id === type.id)
        const isFilm = type.key === 'film'
        const currentFilmValue = isFilm ? filmValues.find((v) => v.id === currentAttr?.value_id) : null
        const allVals = [...(type.values ?? []), ...(extraValues[type.id] ?? [])]
        const searchText = (searchTexts[type.id] ?? '').trim()
        const alreadyExists = allVals.some((v) => normalize(v.value) === normalize(searchText))

        return (
          <div key={type.id} style={{ marginBottom: 8 }}>
            <div style={{ color: '#4a4a4a', fontSize: 11, marginBottom: 3 }}>{type.display_name}</div>

            {isFilm ? (
              <div
                onClick={() => setFilmPickerOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                  background: '#1a1a1a', border: currentFilmValue ? '1px solid #c8832a' : '1px solid #2a2a2a',
                  borderRadius: 4, cursor: 'pointer', minHeight: 30
                }}
              >
                {currentFilmValue ? (
                  <>
                    <FilmTag value={currentFilmValue.value} iconKey={currentFilmValue.icon_key} iconSize={18} style={{ color: '#ddd', fontSize: 12, flex: 1 }} />
                    <Button size="small" type="text" onClick={(e) => { e.stopPropagation(); handleAttrChange(type.id, null) }}
                      style={{ color: '#555', padding: 0, fontSize: 11, height: 18, minWidth: 'auto' }}>✕</Button>
                  </>
                ) : (
                  <>
                    <PictureOutlined style={{ color: '#555', fontSize: 13 }} />
                    <span style={{ color: '#555', fontSize: 12 }}>点击选择胶片...</span>
                  </>
                )}
              </div>
            ) : (
              <Select
                size="small"
                showSearch
                style={{ width: '100%' }}
                value={currentAttr?.value_id ?? undefined}
                onChange={(v) => handleAttrChange(type.id, v ?? null)}
                onSearch={(v) => setSearchTexts((prev) => ({ ...prev, [type.id]: v }))}
                allowClear
                onClear={() => handleAttrChange(type.id, null)}
                placeholder="未设置"
                filterOption={(input, option) =>
                  normalize(String(option?.label ?? '')).includes(normalize(input))
                }
                options={allVals.map((v) => ({ value: v.id, label: v.value }))}
                dropdownRender={(menu) => (
                  <>
                    {menu}
                    {searchText && !alreadyExists && (
                      <>
                        <Divider style={{ margin: '4px 0', borderColor: '#2a2a2a' }} />
                        <div
                          style={{ padding: '5px 8px', cursor: 'pointer', color: '#c8832a', fontSize: 12 }}
                          onMouseDown={async (e) => { e.preventDefault(); await handleCreateAndSelect(type.id, searchText) }}
                        >
                          <PlusOutlined /> 新增 "{searchText}"
                        </div>
                      </>
                    )}
                  </>
                )}
                styles={{ popup: { root: { background: '#1a1a1a' } } }}
              />
            )}
          </div>
        )
      })}

      {filmTypeId && (
        <FilmIconPicker
          open={filmPickerOpen}
          filmValues={filmValues}
          selectedValueId={photo.attributes.find((a) => a.attribute_type_id === filmTypeId)?.value_id ?? null}
          onSelect={(valueId) => { handleAttrChange(filmTypeId, valueId); setFilmPickerOpen(false) }}
          onNewValue={(val) => {
            setFilmValues((prev) => [...prev, val])
            setExtraValues((prev) => ({ ...prev, [filmTypeId]: [...(prev[filmTypeId] ?? []), val] }))
          }}
          onClose={() => setFilmPickerOpen(false)}
        />
      )}
    </>
  )
}

// ─── Main viewer ──────────────────────────────────────────────────────────────

interface PhotoViewerProps {
  attrTypes: AttributeType[]
  onAttrChanged?: () => void
}

export default function PhotoViewer({ attrTypes, onAttrChanged }: PhotoViewerProps) {
  const {
    viewerPhoto,
    setViewerPhoto,
    viewerPhotos,
    viewerIndex,
    setViewerIndex,
    closeViewer,
    iccProfiles,
    activeProfile,
    setActiveProfile
  } = useStore()

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [histogram, setHistogram] = useState<{ r: number[]; g: number[]; b: number[] } | null>(null)
  // live photo data (refreshed after attr edits)
  const [livePhoto, setLivePhoto] = useState<Photo | null>(null)

  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const panStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const basePhoto = viewerPhotos[viewerIndex] ?? viewerPhoto
  // Use livePhoto for attribute display/editing; fall back to basePhoto
  const photo = livePhoto ?? basePhoto

  // Reload full photo data (with attributes) when switching photos
  useEffect(() => {
    setLivePhoto(null)
    if (basePhoto) {
      window.api.photos.get(basePhoto.id).then((p) => { if (p) setLivePhoto(p as Photo) })
    }
  }, [basePhoto?.id])

  const loadPreview = useCallback(async (p: Photo, profile?: IccProfile | null) => {
    setLoading(true)
    setPreviewUrl(null)
    setHistogram(null)
    try {
      const result = await window.api.photos.fullPreview(p.file_path, profile?.path, p.rotation ?? 0)
      if (result) {
        setPreviewUrl(result.dataUrl)
        setImgSize({ w: result.width, h: result.height })
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (basePhoto) {
      loadPreview(basePhoto, activeProfile)
      setScale(1)
      setPan({ x: 0, y: 0 })
    }
  }, [basePhoto?.id, basePhoto?.rotation, activeProfile?.path])

  const handlePrev = useCallback(() => {
    if (viewerIndex > 0) setViewerIndex(viewerIndex - 1)
  }, [viewerIndex, setViewerIndex])

  const handleNext = useCallback(() => {
    if (viewerIndex < viewerPhotos.length - 1) setViewerIndex(viewerIndex + 1)
  }, [viewerIndex, viewerPhotos.length, setViewerIndex])

  const close = useCallback(() => closeViewer(), [closeViewer])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!basePhoto) return
      if (e.key === 'ArrowLeft') handlePrev()
      if (e.key === 'ArrowRight') handleNext()
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [basePhoto, handlePrev, handleNext, close])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panStartRef.current) return
      setPan({
        x: panStartRef.current.px + (e.clientX - panStartRef.current.mx),
        y: panStartRef.current.py + (e.clientY - panStartRef.current.my)
      })
    }
    const onUp = () => { panStartRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const isRaw = basePhoto
    ? !['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'webp'].includes(basePhoto.file_type.toLowerCase())
    : false

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setScale((s) => {
      const next = Math.max(0.5, Math.min(8, s - e.deltaY * 0.002))
      if (next <= 1) setPan({ x: 0, y: 0 })
      return next
    })
  }

  const handleImgMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return
    e.preventDefault()
    panStartRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
  }

  // Clicking the background (not the image) closes viewer
  const handleImgAreaClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close()
  }

  const handleAttrChanged = async () => {
    const updated = await window.api.photos.get(basePhoto.id)
    if (updated) setLivePhoto(updated as Photo)
    onAttrChanged?.()
  }

  const handleRotate = async () => {
    if (!basePhoto) return
    const currentRotation = photo?.rotation ?? basePhoto.rotation ?? 0
    const nextRotation = ((currentRotation + 90) % 360) as 0 | 90 | 180 | 270
    const result = await window.api.photos.setRotation(basePhoto.id, nextRotation) as { rotation: number } | null
    const updated = { ...(photo ?? basePhoto), rotation: (result?.rotation ?? nextRotation) as 0 | 90 | 180 | 270 }
    setLivePhoto(updated)
    await loadPreview(updated, activeProfile)
    onAttrChanged?.()
  }

  const navBtn = (onClick: () => void, disabled: boolean, label: string) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        background: 'rgba(255,255,255,0.08)',
        border: 'none',
        borderRadius: 4,
        padding: '14px 10px',
        color: disabled ? '#333' : '#ccc',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 24,
        zIndex: 2,
        ...(label === '‹' ? { left: 12 } : { right: 12 })
      }}
    >
      {label}
    </button>
  )

  return (
    <Modal
      open={!!basePhoto}
      onCancel={close}
      footer={null}
      width="calc(100vw - 48px)"
      style={{ top: 20, padding: 0 }}
      mask={false}
      styles={{
        content: { background: '#111', padding: 0, border: '1px solid #353535', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.85)' },
        header: { background: '#111', borderBottom: '1px solid #1f1f1f', padding: '0 52px 0 16px', margin: 0, height: 52, display: 'flex', alignItems: 'center' },
        body: { padding: 0, height: 'calc(100vh - 130px)', display: 'flex', overflow: 'hidden' }
      }}
      title={basePhoto && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 52 }}>
          <span style={{ color: '#bbb', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {basePhoto.original_name}
            {imgSize && <span style={{ color: '#555', marginLeft: 12 }}>{imgSize.w} × {imgSize.h}</span>}
            {scale !== 1 && <span style={{ color: '#c8832a', marginLeft: 10, fontSize: 11 }}>{Math.round(scale * 100)}%</span>}
          </span>
          <span style={{ color: '#555', fontSize: 12 }}>{viewerIndex + 1} / {viewerPhotos.length}</span>
          <Tooltip title="顺时针旋转 90°">
            <Button
              size="small"
              icon={<RotateRightOutlined />}
              onClick={(e) => { e.stopPropagation(); handleRotate() }}
              style={{ background: '#1f1f1f', borderColor: '#333', color: '#c8832a' }}
            />
          </Tooltip>
          <Button size="small" icon={<FolderOpenOutlined />} onClick={(e) => { e.stopPropagation(); window.api.library.revealFile(basePhoto.file_path) }}
            style={{ background: '#1f1f1f', borderColor: '#333', color: '#ccc' }} />
        </div>
      )}
    >
      {/* Body — guard against null during Modal close animation */}
      {basePhoto && <div style={{ flex: 1, display: 'flex', overflow: 'hidden', height: '100%' }}>
        {/* Image area — clicking background closes viewer */}
        <div
          style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}
          onWheel={handleWheel}
          onClick={handleImgAreaClick}
        >
          {navBtn(handlePrev, viewerIndex === 0, '‹')}

          {loading ? (
            <div style={{ textAlign: 'center' }}>
              <Spin size="large" />
              <div style={{ color: '#666', marginTop: 12, fontSize: 13 }}>{isRaw ? '解码 RAW 文件…' : '加载中…'}</div>
            </div>
          ) : previewUrl ? (
            <img
              ref={imgRef}
              src={previewUrl}
              alt={basePhoto.original_name}
              style={{
                maxWidth: 'calc(100% - 100px)',
                maxHeight: 'calc(100% - 40px)',
                objectFit: 'contain',
                borderRadius: 4,
                boxShadow: '0 0 40px rgba(0,0,0,0.8)',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                transformOrigin: 'center center',
                transition: panStartRef.current ? 'none' : 'transform 0.08s ease',
                cursor: scale > 1 ? (panStartRef.current ? 'grabbing' : 'grab') : 'default'
              }}
              onMouseDown={handleImgMouseDown}
              onClick={(e) => e.stopPropagation()}
              onLoad={() => {
                if (imgRef.current) {
                  try { setHistogram(computeHistogram(imgRef.current)) } catch {}
                }
              }}
            />
          ) : (
            <div style={{ textAlign: 'center', color: '#555' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>⚠</div>
              <div>无法加载预览</div>
            </div>
          )}

          {navBtn(handleNext, viewerIndex >= viewerPhotos.length - 1, '›')}
        </div>

        {/* Side panel */}
        <div style={{ width: 288, background: '#111', borderLeft: '1px solid #1f1f1f', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 20px' }}>

            {/* Histogram */}
            <div style={{ marginBottom: 14 }}>
              <SectionLabel>直方图</SectionLabel>
              <HistogramCanvas data={histogram} />
            </div>

            {/* ICC (RAW only) */}
            {isRaw && (
              <div style={{ marginBottom: 14 }}>
                <SectionLabel>色彩配置</SectionLabel>
                <Select size="small" style={{ width: '100%' }}
                  value={activeProfile?.path ?? '__none__'}
                  onChange={(v) => setActiveProfile(iccProfiles.find((p) => p.path === v) ?? null)}
                  options={[
                    { value: '__none__', label: '相机默认' },
                    ...iccProfiles.map((p) => ({ value: p.path, label: p.name + (p.isPreset ? '' : ' *') }))
                  ]}
                />
              </div>
            )}

            {/* File info */}
            <div style={{ marginBottom: 14 }}>
              <SectionLabel>文件信息</SectionLabel>
              <MetaRow label="文件名" value={basePhoto.original_name} />
              <MetaRow label="格式" value={basePhoto.file_type.toUpperCase()} />
              <MetaRow label="旋转" value={`${photo?.rotation ?? basePhoto.rotation ?? 0}°`} />
              {imgSize && <MetaRow label="尺寸" value={`${imgSize.w} × ${imgSize.h}`} />}
              {basePhoto.file_size != null && <MetaRow label="大小" value={formatSize(basePhoto.file_size)} />}
              {/* Shot date — editable */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ color: '#4a4a4a', fontSize: 11, width: 56, flexShrink: 0 }}>拍摄日期</span>
                <DatePicker
                  size="small"
                  style={{ flex: 1, background: '#1a1a1a', borderColor: '#2a2a2a', fontSize: 11 }}
                  value={photo?.shot_date ? dayjs(photo.shot_date) : null}
                  placeholder={(photo?.imported_at ?? '').substring(0, 10) || '入库时间'}
                  onChange={async (d) => {
                    if (!photo) return
                    const val = d ? d.format('YYYY-MM-DD') : null
                    await window.api.photos.setShotDate(photo.id, val)
                    handleAttrChanged()
                  }}
                  allowClear
                />
              </div>
              <MetaRow label="入库时间" value={(basePhoto.imported_at ?? '').substring(0, 16)} />
            </div>

            <Divider style={{ borderColor: '#1a1a1a', margin: '8px 0' }} />

            {/* Attribute editing */}
            <div style={{ marginBottom: 14 }}>
              <SectionLabel>属性标签</SectionLabel>
              {photo && attrTypes.length > 0 ? (
                <AttrEditor photo={photo} attrTypes={attrTypes} onChanged={handleAttrChanged} />
              ) : (
                <div style={{ color: '#444', fontSize: 12 }}>加载中...</div>
              )}
            </div>

            {/* Notes */}
            {photo?.notes && (
              <>
                <Divider style={{ borderColor: '#1a1a1a', margin: '8px 0' }} />
                <div>
                  <SectionLabel>备注</SectionLabel>
                  <div style={{ color: '#888', fontSize: 12, lineHeight: '18px', wordBreak: 'break-all' }}>{photo.notes}</div>
                </div>
              </>
            )}
          </div>

          <div style={{ padding: '8px 14px', borderTop: '1px solid #1a1a1a', flexShrink: 0 }}>
            <div style={{ color: '#383838', fontSize: 11, textAlign: 'center' }}>
              Esc 退出 · 滚轮缩放 · ← → 切换
            </div>
          </div>
        </div>
      </div>}
    </Modal>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: '#555', fontSize: 11, marginBottom: 6, letterSpacing: 0.4, textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 12, lineHeight: '18px', alignItems: 'flex-start' }}>
      <span style={{ color: '#4a4a4a', flexShrink: 0, width: 56 }}>{label}</span>
      <span style={{ color: '#999', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value}>{value}</span>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
