import React, { useEffect, useState, useCallback } from 'react'
import { Drawer, Button, Select, Tag, Divider, Space, Input, Tooltip, message, Popconfirm, DatePicker } from 'antd'
import {
  FolderOpenOutlined,
  ReloadOutlined,
  DeleteOutlined,
  PictureOutlined,
  PlusOutlined,
  EnvironmentOutlined,
  CloseCircleOutlined
} from '@ant-design/icons'
import type { Photo, AttributeType, AttributeValue, Location } from '../../types'
import dayjs from 'dayjs'
import { useStore } from '../../store'
import { FilmTag, FilmIconPicker } from '../FilmIcon'
import LocationPicker from '../LocationPicker'

interface DetailDrawerProps {
  photoId: number | null
  attrTypes: AttributeType[]
  onClose: () => void
  onDeleted: () => void
  onMoved?: () => void
}

export default function DetailDrawer({ photoId, attrTypes, onClose, onDeleted, onMoved }: DetailDrawerProps) {
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [notes, setNotes] = useState('')
  const [editingNotes, setEditingNotes] = useState(false)
  const [filmPickerOpen, setFilmPickerOpen] = useState(false)
  const [filmValues, setFilmValues] = useState<AttributeValue[]>([])
  const [filmTypeId, setFilmTypeId] = useState<number | null>(null)
  // per-type extra values created inline (not yet in attrTypes from store)
  const [extraValues, setExtraValues] = useState<Record<number, AttributeValue[]>>({})
  const [searchTexts, setSearchTexts] = useState<Record<number, string>>({})
  const [photoLocations, setPhotoLocations] = useState<Location[]>([])
  const [showLocationPicker, setShowLocationPicker] = useState(false)
  const { subLibraries } = useStore()

  const load = useCallback(async () => {
    if (!photoId) return
    const p = await window.api.photos.get(photoId)
    setPhoto(p)
    setNotes(p?.notes ?? '')
    const locs = await window.api.locations.forPhoto(photoId) as Location[]
    setPhotoLocations(locs)
  }, [photoId])

  // 加载胶片属性类型的值列表
  useEffect(() => {
    const filmType = attrTypes.find((t) => t.key === 'film')
    if (filmType) {
      setFilmTypeId(filmType.id)
      window.api.attrs.listValues(filmType.id).then((vals) => setFilmValues(vals as AttributeValue[]))
    }
  }, [attrTypes])

  useEffect(() => { load() }, [load])

  const handleAttrChange = async (typeId: number, valueId: number | null) => {
    if (!photo) return
    const existing = photo.attributes.filter((a) => a.attribute_type_id !== typeId)
    const newAttrs = valueId
      ? [...existing.map((a) => ({ typeId: a.attribute_type_id, valueId: a.value_id })), { typeId, valueId }]
      : existing.map((a) => ({ typeId: a.attribute_type_id, valueId: a.value_id }))
    await window.api.photos.setAttributes(photo.id, newAttrs)
    load()
  }

  const handleSaveNotes = async () => {
    if (!photo) return
    await window.api.photos.updateNotes(photo.id, notes)
    setEditingNotes(false)
    message.success('备注已保存')
  }

  const handleDelete = async () => {
    if (!photo) return
    await window.api.photos.delete([photo.id], false)
    message.success('已从库中移除')
    onDeleted()
    onClose()
  }

  const handleDeleteFile = async () => {
    if (!photo) return
    await window.api.photos.delete([photo.id], true)
    message.success('已删除文件')
    onDeleted()
    onClose()
  }

  const handleMoveSubLib = async (subLibId: number | null) => {
    if (!photo) return
    await window.api.photos.moveToSubLibrary([photo.id], subLibId)
    load()
    onMoved?.()
  }

  const flattenSubLibs = (libs: typeof subLibraries, depth = 0): { id: number; name: string; depth: number }[] =>
    libs.flatMap((l) => [{ id: l.id, name: l.name, depth }, ...flattenSubLibs(l.children, depth + 1)])

  const subLibOptions = [
    { value: null, label: '未分类' },
    ...flattenSubLibs(subLibraries).map((l) => ({
      value: l.id,
      label: '　'.repeat(l.depth) + l.name
    }))
  ]

  const formatSize = (bytes?: number) => {
    if (!bytes) return '-'
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return (
    <Drawer
      title={photo?.original_name ?? '照片详情'}
      placement="right"
      width={320}
      onClose={onClose}
      open={!!photoId}
      styles={{
        body: { padding: '12px 16px', background: '#181818' },
        header: { background: '#1a1a1a', borderBottom: '1px solid #252525', color: '#ccc' },
        wrapper: { boxShadow: '-4px 0 20px rgba(0,0,0,0.6)' }
      }}
    >
      {photo && (
        <>
          {/* 缩略图预览 */}
          {photo.thumb_path && photo.thumb_ready ? (
            <img
              src={`localfile://${encodeURIComponent(photo.thumb_path)}`}
              style={{ width: '100%', borderRadius: 6, marginBottom: 12, maxHeight: 200, objectFit: 'contain', background: '#111' }}
            />
          ) : null}

          {/* 文件信息 */}
          <div style={{ background: '#1e1e1e', borderRadius: 6, padding: 10, marginBottom: 12 }}>
            <Row label="文件名" value={photo.original_name} />
            <Row label="格式" value={photo.file_type.toUpperCase()} />
            <Row label="尺寸" value={photo.width && photo.height ? `${photo.width} × ${photo.height}` : '-'} />
            <Row label="大小" value={formatSize(photo.file_size)} />
            <Row label="入库时间" value={photo.imported_at.substring(0, 16)} />
            {/* 拍摄日期：可编辑 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ color: '#555', fontSize: 11 }}>拍摄日期</span>
              <DatePicker
                size="small"
                value={photo.shot_date ? dayjs(photo.shot_date) : null}
                placeholder={photo.imported_at.substring(0, 10) + ' (入库)'}
                onChange={async (d) => {
                  const val = d ? d.format('YYYY-MM-DD') : null
                  await window.api.photos.setShotDate(photo.id, val)
                  load()
                }}
                allowClear
                style={{ background: '#2a2a2a', borderColor: '#333', fontSize: 11, height: 24 }}
              />
            </div>
          </div>

          {/* 属性编辑 */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: '#888', fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
              属性
            </div>
            {attrTypes
              .filter((t) => t.is_active && t.key !== 'imported_at')
              .map((type) => {
                const currentAttr = photo.attributes.find((a) => a.attribute_type_id === type.id)
                const isFilm = type.key === 'film'
                const currentFilmValue = isFilm ? filmValues.find((v) => v.id === currentAttr?.value_id) : null

                if (isFilm) {
                  return (
                    <div key={type.id} style={{ marginBottom: 8 }}>
                      <div style={{ color: '#777', fontSize: 11, marginBottom: 3 }}>{type.display_name}</div>
                      <div
                        onClick={() => setFilmPickerOpen(true)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '5px 8px',
                          background: '#222',
                          border: currentFilmValue ? '1px solid #c8832a' : '1px solid #333',
                          borderRadius: 4,
                          cursor: 'pointer',
                          minHeight: 30
                        }}
                      >
                        {currentFilmValue ? (
                          <FilmTag
                            value={currentFilmValue.value}
                            iconKey={currentFilmValue.icon_key}
                            iconSize={20}
                            style={{ color: '#e0e0e0', fontSize: 12, flex: 1 }}
                          />
                        ) : (
                          <>
                            <PictureOutlined style={{ color: '#555', fontSize: 14 }} />
                            <span style={{ color: '#555', fontSize: 12 }}>点击选择胶片...</span>
                          </>
                        )}
                        {currentFilmValue && (
                          <Button
                            size="small"
                            type="text"
                            onClick={(e) => { e.stopPropagation(); handleAttrChange(type.id, null) }}
                            style={{ marginLeft: 'auto', color: '#555', padding: 0, fontSize: 11, height: 20 }}
                          >
                            ✕
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                }

                return (
                  <div key={type.id} style={{ marginBottom: 8 }}>
                    <div style={{ color: '#777', fontSize: 11, marginBottom: 3 }}>{type.display_name}</div>
                    <Select
                      size="small"
                      style={{ width: '100%' }}
                      value={currentAttr?.value_id ?? null}
                      onChange={(v) => handleAttrChange(type.id, v)}
                      onSearch={(v) => setSearchTexts((prev) => ({ ...prev, [type.id]: v }))}
                      allowClear
                      onClear={() => handleAttrChange(type.id, null)}
                      placeholder="未设置"
                      showSearch
                      filterOption={(input, option) => {
                        const n = (s: string) => s.replace(/\s+/g, '').toLowerCase()
                        return n(String(option?.label ?? '')).includes(n(input))
                      }}
                      options={[
                        ...(type.values ?? []).map((v) => ({ value: v.id, label: v.value })),
                        ...(extraValues[type.id] ?? []).map((v) => ({ value: v.id, label: v.value }))
                      ]}
                      dropdownRender={(menu) => {
                        const searchText = (searchTexts[type.id] ?? '').trim()
                        const allVals = [...(type.values ?? []), ...(extraValues[type.id] ?? [])]
                        const n = (s: string) => s.replace(/\s+/g, '').toLowerCase()
                        const alreadyExists = allVals.some((v) => n(v.value) === n(searchText))
                        return (
                          <>
                            {menu}
                            {searchText && !alreadyExists && (
                              <>
                                <Divider style={{ margin: '4px 0', borderColor: '#333' }} />
                                <div
                                  style={{ padding: '6px 8px', cursor: 'pointer', color: '#c8832a', fontSize: 12 }}
                                  onMouseDown={async (e) => {
                                    e.preventDefault()
                                    const newId = await window.api.attrs.addValue(type.id, searchText) as number
                                    const newVal: AttributeValue = { id: newId, attribute_type_id: type.id, value: searchText, is_preset: 0 }
                                    setExtraValues((prev) => ({ ...prev, [type.id]: [...(prev[type.id] ?? []), newVal] }))
                                    setSearchTexts((prev) => ({ ...prev, [type.id]: '' }))
                                    handleAttrChange(type.id, newId)
                                  }}
                                >
                                  <PlusOutlined /> 新增 "{searchText}"
                                </div>
                              </>
                            )}
                          </>
                        )
                      }}
                    />
                  </div>
                )
              })}
          </div>

          {/* 子库 */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: '#777', fontSize: 11, marginBottom: 3 }}>所属子库</div>
            <Select
              size="small"
              style={{ width: '100%' }}
              value={photo.sub_library_id ?? null}
              onChange={handleMoveSubLib}
              options={subLibOptions as never}
            />
          </div>

          <Divider style={{ borderColor: '#252525', margin: '8px 0' }} />

          {/* 拍摄地点 */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: '#888', fontSize: 11, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>拍摄地点</span>
              <Button
                size="small"
                type="text"
                icon={<PlusOutlined />}
                onClick={() => setShowLocationPicker((v) => !v)}
                style={{ color: '#c8832a', padding: 0, height: 'auto', fontSize: 11 }}
              >
                添加
              </Button>
            </div>

            {photoLocations.map((loc) => (
              <div
                key={loc.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  background: '#1e1e1e',
                  borderRadius: 4,
                  marginBottom: 4,
                  border: '1px solid #2a2a2a'
                }}
              >
                <EnvironmentOutlined style={{ color: '#c8832a', fontSize: 12, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#ccc', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loc.name}</div>
                  {loc.address && (
                    <div style={{ color: '#555', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loc.address}</div>
                  )}
                </div>
                <Button
                  size="small"
                  type="text"
                  icon={<CloseCircleOutlined />}
                  onClick={async () => {
                    if (!photo) return
                    await window.api.locations.removeFromPhoto(photo.id, loc.id)
                    setPhotoLocations((prev) => prev.filter((l) => l.id !== loc.id))
                  }}
                  style={{ color: '#444', padding: 0, flexShrink: 0 }}
                />
              </div>
            ))}

            {showLocationPicker && (
              <LocationPicker
                placeholder="搜索地点..."
                onSelect={async (loc) => {
                  if (!photo) return
                  await window.api.locations.addToPhoto(photo.id, loc.id)
                  setPhotoLocations((prev) =>
                    prev.find((l) => l.id === loc.id) ? prev : [...prev, loc]
                  )
                  setShowLocationPicker(false)
                }}
              />
            )}
          </div>

          <Divider style={{ borderColor: '#252525', margin: '8px 0' }} />

          {/* 备注 */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: '#888', fontSize: 11, marginBottom: 6 }}>备注</div>
            {editingNotes ? (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input.TextArea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  style={{ background: '#222', borderColor: '#333', color: '#ccc' }}
                  autoFocus
                />
                <Space>
                  <Button size="small" type="primary" onClick={handleSaveNotes} style={{ background: '#c8832a', borderColor: '#c8832a' }}>
                    保存
                  </Button>
                  <Button size="small" onClick={() => setEditingNotes(false)}>取消</Button>
                </Space>
              </Space>
            ) : (
              <div
                onClick={() => setEditingNotes(true)}
                style={{
                  minHeight: 40,
                  padding: '6px 8px',
                  background: '#1e1e1e',
                  borderRadius: 4,
                  color: notes ? '#aaa' : '#555',
                  fontSize: 12,
                  cursor: 'text',
                  border: '1px solid #2a2a2a'
                }}
              >
                {notes || '点击添加备注...'}
              </div>
            )}
          </div>

          <Divider style={{ borderColor: '#252525', margin: '8px 0' }} />

          {/* 操作 */}
          <Space direction="vertical" style={{ width: '100%' }} size={6}>
            <Button
              block
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={() => window.api.library.revealFile(photo.file_path)}
              style={{ background: '#1e1e1e', borderColor: '#2a2a2a', color: '#ccc' }}
            >
              在文件管理器中显示
            </Button>
            <Button
              block
              size="small"
              icon={<ReloadOutlined />}
              onClick={async () => { await window.api.library.regenThumb(photo.id); load() }}
              style={{ background: '#1e1e1e', borderColor: '#2a2a2a', color: '#ccc' }}
            >
              重新生成缩略图
            </Button>
            <Popconfirm title="从库中移除？" description="仅移除索引，不删除文件" onConfirm={handleDelete} okText="移除" cancelText="取消">
              <Button block size="small" icon={<DeleteOutlined />} style={{ background: '#1e1e1e', borderColor: '#2a2a2a', color: '#c8832a' }}>
                从库中移除
              </Button>
            </Popconfirm>
            <Popconfirm title="永久删除文件？" description="此操作不可恢复" onConfirm={handleDeleteFile} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
              <Button block size="small" danger icon={<DeleteOutlined />}>
                删除文件
              </Button>
            </Popconfirm>
          </Space>
        </>
      )}

      {/* 胶片图标选择弹窗 */}
      {photo && filmTypeId && (
        <FilmIconPicker
          open={filmPickerOpen}
          filmValues={filmValues}
          selectedValueId={photo.attributes.find((a) => a.attribute_type_id === filmTypeId)?.value_id ?? null}
          onSelect={(valueId) => { handleAttrChange(filmTypeId, valueId) }}
          onNewValue={(val) => setFilmValues((prev) => [...prev, val])}
          onClose={() => setFilmPickerOpen(false)}
        />
      )}
    </Drawer>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ color: '#555', fontSize: 11 }}>{label}</span>
      <span style={{ color: '#999', fontSize: 11, maxWidth: '65%', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}
