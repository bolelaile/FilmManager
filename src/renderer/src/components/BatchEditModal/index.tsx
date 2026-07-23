import React, { useState, useEffect } from 'react'
import { Modal, Select, Button, Space, Divider, message } from 'antd'
import { PlusOutlined, PictureOutlined } from '@ant-design/icons'
import type { AttributeType, AttributeValue } from '../../types'
import { FilmTag, FilmIconPicker } from '../FilmIcon'

interface BatchEditModalProps {
  open: boolean
  selectedIds: number[]
  attrTypes: AttributeType[]
  onClose: () => void
  onDone: () => void
}

const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase()

export default function BatchEditModal({ open, selectedIds, attrTypes, onClose, onDone }: BatchEditModalProps) {
  // typeId -> selected valueId (null = skip this type)
  const [edits, setEdits] = useState<Record<number, number | null>>({})
  const [extraValues, setExtraValues] = useState<Record<number, AttributeValue[]>>({})
  const [searchTexts, setSearchTexts] = useState<Record<number, string>>({})
  const [filmValues, setFilmValues] = useState<AttributeValue[]>([])
  const [filmTypeId, setFilmTypeId] = useState<number | null>(null)
  const [filmPickerOpen, setFilmPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      setEdits({})
      setExtraValues({})
      setSearchTexts({})
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

    if (attrPairs.length === 0) {
      message.warning('请至少设置一个属性')
      return
    }

    setSaving(true)
    try {
      await window.api.photos.batchSetAttributes(selectedIds, attrPairs)
      message.success(`已更新 ${selectedIds.length} 张照片的属性`)
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const visibleTypes = attrTypes.filter((t) => t.is_active && t.key !== 'imported_at')

  return (
    <>
      <Modal
        title={`批量编辑属性（${selectedIds.length} 张照片）`}
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
        draggable
        styles={{
          content: { background: '#1a1a1a', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)' },
          header: { background: '#1a1a1a', borderBottom: '1px solid #252525' },
          footer: { background: '#1a1a1a', borderTop: '1px solid #252525' }
        }}
      >
        <div style={{ color: '#666', fontSize: 12, marginBottom: 16 }}>
          留空的属性将不会修改；已填写的属性将覆盖所有选中照片的对应属性。
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
