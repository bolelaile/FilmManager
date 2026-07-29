import React, { useState, useEffect } from 'react'
import { Modal, Select, Button, Space, Divider, message, Segmented } from 'antd'
import { CloseCircleOutlined, EnvironmentOutlined, PlusOutlined, PictureOutlined } from '@ant-design/icons'
import type { AttributeType, AttributeValue, Location } from '../../types'
import { FilmTag, FilmIconPicker } from '../FilmIcon'
import LocationPicker from '../LocationPicker'

interface BatchEditModalProps {
  open: boolean
  selectedIds: number[]
  attrTypes: AttributeType[]
  onClose: () => void
  onDone: () => void
}

const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase()
type LocationEditMode = 'skip' | 'set' | 'clear'

export default function BatchEditModal({ open, selectedIds, attrTypes, onClose, onDone }: BatchEditModalProps) {
  // typeId -> selected valueId (null = skip this type)
  const [edits, setEdits] = useState<Record<number, number | null>>({})
  const [extraValues, setExtraValues] = useState<Record<number, AttributeValue[]>>({})
  const [searchTexts, setSearchTexts] = useState<Record<number, string>>({})
  const [filmValues, setFilmValues] = useState<AttributeValue[]>([])
  const [filmTypeId, setFilmTypeId] = useState<number | null>(null)
  const [filmPickerOpen, setFilmPickerOpen] = useState(false)
  const [locationEditMode, setLocationEditMode] = useState<LocationEditMode>('skip')
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      setEdits({})
      setExtraValues({})
      setSearchTexts({})
      setLocationEditMode('skip')
      setSelectedLocation(null)
    }
  }, [open])

  useEffect(() => {
    const filmType = attrTypes.find((t) => t.key === 'film')
    if (filmType) {
      setFilmTypeId(filmType.id)
      window.api.attrs.listValues(filmType.id).then((vals) => setFilmValues(vals as AttributeValue[]))
    }
  }, [attrTypes])

  const handleSave = async () => {
    const attrPairs = Object.entries(edits)
      .filter(([, v]) => v !== null)
      .map(([typeId, valueId]) => ({ typeId: Number(typeId), valueId: valueId! }))

    if (locationEditMode === 'set' && !selectedLocation) {
      message.warning('请选择拍摄地点')
      return
    }

    if (attrPairs.length === 0 && locationEditMode === 'skip') {
      message.warning('请至少设置一个属性或拍摄地点')
      return
    }

    setSaving(true)
    try {
      if (attrPairs.length > 0) {
        await window.api.photos.batchSetAttributes(selectedIds, attrPairs)
      }
      if (locationEditMode === 'set') {
        await window.api.locations.setForPhotos(selectedIds, selectedLocation!.id)
      } else if (locationEditMode === 'clear') {
        await window.api.locations.setForPhotos(selectedIds, null)
      }
      message.success(`已更新 ${selectedIds.length} 张照片的信息`)
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const visibleTypes = attrTypes.filter((t) => t.is_active && t.key !== 'imported_at')

  return (
    <>
      <Modal
        title={`编辑照片信息（${selectedIds.length} 张照片）`}
        open={open}
        onCancel={onClose}
        footer={
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              loading={saving}
              onClick={handleSave}
              style={{ background: '#c8832a', borderColor: '#c8832a' }}
            >
              应用到所选照片
            </Button>
          </Space>
        }
        width={480}
        mask={false}
        styles={{
          content: { background: '#1a1a1a', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)' },
          header: { background: '#1a1a1a', borderBottom: '1px solid #252525' },
          footer: { background: '#1a1a1a', borderTop: '1px solid #252525' },
          body: { maxHeight: '65vh', overflowY: 'auto' }
        }}
      >
        <div style={{ color: '#666', fontSize: 12, marginBottom: 16 }}>
          留空的属性不会修改；已填写的内容将覆盖所有选中照片的对应信息。
        </div>

        {visibleTypes.map((type) => {
          const isFilm = type.key === 'film'
          const selectedValueId = edits[type.id] ?? null
          const allVals = [...(type.values ?? []), ...(extraValues[type.id] ?? [])]
          const searchText = (searchTexts[type.id] ?? '').trim()
          const alreadyExists = allVals.some((v) => normalize(v.value) === normalize(searchText))
          const currentFilmValue = isFilm ? filmValues.find((v) => v.id === selectedValueId) : null

          return (
            <div key={type.id} style={{ marginBottom: 12 }}>
              <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>{type.display_name}</div>

              {isFilm ? (
                <div
                  onClick={() => setFilmPickerOpen(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                    background: '#222', border: currentFilmValue ? '1px solid #c8832a' : '1px solid #333',
                    borderRadius: 6, cursor: 'pointer', minHeight: 34
                  }}
                >
                  {currentFilmValue ? (
                    <>
                      <FilmTag value={currentFilmValue.value} iconKey={currentFilmValue.icon_key} iconSize={20}
                        style={{ color: '#ddd', fontSize: 13, flex: 1 }} />
                      <Button size="small" type="text"
                        onClick={(e) => { e.stopPropagation(); setEdits((p) => ({ ...p, [type.id]: null })) }}
                        style={{ color: '#555', padding: 0, fontSize: 11, height: 20, minWidth: 'auto' }}>✕</Button>
                    </>
                  ) : (
                    <>
                      <PictureOutlined style={{ color: '#555', fontSize: 14 }} />
                      <span style={{ color: '#555', fontSize: 13 }}>点击选择胶片...</span>
                    </>
                  )}
                </div>
              ) : (
                <Select
                  showSearch
                  allowClear
                  style={{ width: '100%' }}
                  placeholder="不修改"
                  value={selectedValueId ?? undefined}
                  onChange={(v) => setEdits((p) => ({ ...p, [type.id]: v ?? null }))}
                  onSearch={(v) => setSearchTexts((p) => ({ ...p, [type.id]: v }))}
                  onClear={() => setEdits((p) => ({ ...p, [type.id]: null }))}
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
                            style={{ padding: '5px 10px', cursor: 'pointer', color: '#c8832a', fontSize: 12 }}
                            onMouseDown={async (e) => {
                              e.preventDefault()
                              const newId = await window.api.attrs.addValue(type.id, searchText) as number
                              const newVal: AttributeValue = { id: newId, attribute_type_id: type.id, value: searchText, is_preset: 0 }
                              setExtraValues((p) => ({ ...p, [type.id]: [...(p[type.id] ?? []), newVal] }))
                              setSearchTexts((p) => ({ ...p, [type.id]: '' }))
                              setEdits((p) => ({ ...p, [type.id]: newId }))
                            }}
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

        <Divider style={{ borderColor: '#2a2a2a', margin: '16px 0 12px' }} />
        <div style={{ marginBottom: 4 }}>
          <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>拍摄地点</div>
          <Segmented
            block
            value={locationEditMode}
            options={[
              { label: '不修改', value: 'skip' },
              { label: '设置或更换', value: 'set' },
              { label: '清除', value: 'clear' }
            ]}
            onChange={(value) => {
              const mode = value as LocationEditMode
              setLocationEditMode(mode)
              if (mode !== 'set') setSelectedLocation(null)
            }}
          />

          {locationEditMode === 'set' && (
            <div style={{ marginTop: 8 }}>
              {selectedLocation ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, minHeight: 36,
                  padding: '6px 10px', background: '#222', border: '1px solid #c8832a', borderRadius: 6
                }}>
                  <EnvironmentOutlined style={{ color: '#c8832a', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#ddd', fontSize: 13 }}>{selectedLocation.name}</div>
                    {selectedLocation.address && (
                      <div style={{ color: '#666', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedLocation.address}
                      </div>
                    )}
                  </div>
                  <Button
                    size="small"
                    type="text"
                    title="重新选择地点"
                    icon={<CloseCircleOutlined />}
                    onClick={() => setSelectedLocation(null)}
                    style={{ color: '#666', padding: 0, flexShrink: 0 }}
                  />
                </div>
              ) : (
                <LocationPicker
                  placeholder="搜索要设置的拍摄地点..."
                  onSelect={setSelectedLocation}
                />
              )}
            </div>
          )}

          {locationEditMode === 'clear' && (
            <div style={{ marginTop: 7, color: '#d89673', fontSize: 11 }}>
              将移除所选照片现有的拍摄地点
            </div>
          )}
        </div>
      </Modal>

      {filmTypeId && (
        <FilmIconPicker
          open={filmPickerOpen}
          filmValues={filmValues}
          selectedValueId={edits[filmTypeId] ?? null}
          onSelect={(id) => { setEdits((p) => ({ ...p, [filmTypeId]: id })); setFilmPickerOpen(false) }}
          onNewValue={(val) => setFilmValues((p) => [...p, val])}
          onClose={() => setFilmPickerOpen(false)}
        />
      )}
    </>
  )
}
