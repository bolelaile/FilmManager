import React, { useState, useEffect } from 'react'
import {
  Modal, Tabs, Button, Input, List, Switch, Popconfirm,
  Space, Tag, message, Divider, Empty, Tooltip
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  CheckOutlined, CloseOutlined, LockOutlined, ImportOutlined, PictureOutlined
} from '@ant-design/icons'
import type { AttributeType, AttributeValue, IccProfile } from '../../types'
import { useStore } from '../../store'
import { FilmIconImg } from '../FilmIcon'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  onAttrChange: () => void
}

export default function SettingsModal({ open, onClose, onAttrChange }: SettingsModalProps) {
  const [attrTypes, setAttrTypes] = useState<AttributeType[]>([])
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null)
  const [attrValues, setAttrValues] = useState<AttributeValue[]>([])
  const [newTypeName, setNewTypeName] = useState('')
  const [newValueName, setNewValueName] = useState('')
  const [editingTypeId, setEditingTypeId] = useState<number | null>(null)
  const [editingTypeName, setEditingTypeName] = useState('')
  const [editingValueId, setEditingValueId] = useState<number | null>(null)
  const [editingValueName, setEditingValueName] = useState('')
  const [profiles, setProfiles] = useState<IccProfile[]>([])
  const { setIccProfiles, mergeFilmIconCache } = useStore()

  const load = async () => {
    const types = await window.api.attrs.listTypes() as AttributeType[]
    setAttrTypes(types)
    if (selectedTypeId) {
      const vals = await window.api.attrs.listValues(selectedTypeId) as AttributeValue[]
      setAttrValues(vals)
    }
  }

  const loadProfiles = async () => {
    const p = await window.api.library.listProfiles() as IccProfile[]
    setProfiles(p)
    setIccProfiles(p)
  }

  useEffect(() => {
    if (open) { load(); loadProfiles() }
  }, [open])

  useEffect(() => {
    if (selectedTypeId) {
      window.api.attrs.listValues(selectedTypeId).then((v) => setAttrValues(v as AttributeValue[]))
    }
  }, [selectedTypeId])

  const handleAddType = async () => {
    if (!newTypeName.trim()) return
    await window.api.attrs.addType(newTypeName.trim())
    setNewTypeName('')
    load()
    onAttrChange()
  }

  const handleRenameType = async (id: number) => {
    await window.api.attrs.updateType(id, editingTypeName)
    setEditingTypeId(null)
    load()
    onAttrChange()
  }

  const handleToggleType = async (id: number, active: boolean) => {
    await window.api.attrs.toggleType(id, active)
    load()
    onAttrChange()
  }

  const handleDeleteType = async (id: number) => {
    await window.api.attrs.deleteType(id)
    if (selectedTypeId === id) setSelectedTypeId(null)
    load()
    onAttrChange()
  }

  const handleAddValue = async () => {
    if (!newValueName.trim() || !selectedTypeId) return
    await window.api.attrs.addValue(selectedTypeId, newValueName.trim())
    setNewValueName('')
    const vals = await window.api.attrs.listValues(selectedTypeId) as AttributeValue[]
    setAttrValues(vals)
    onAttrChange()
  }

  const handleRenameValue = async (id: number) => {
    await window.api.attrs.updateValue(id, editingValueName)
    setEditingValueId(null)
    const vals = await window.api.attrs.listValues(selectedTypeId!) as AttributeValue[]
    setAttrValues(vals)
    onAttrChange()
  }

  const handleDeleteValue = async (id: number) => {
    await window.api.attrs.deleteValue(id)
    const vals = await window.api.attrs.listValues(selectedTypeId!) as AttributeValue[]
    setAttrValues(vals)
    onAttrChange()
  }

  const handleChangeIcon = async (value: AttributeValue) => {
    const key = await window.api.attrs.importCustomIcon() as string | null
    if (!key) return
    await window.api.attrs.updateValue(value.id, value.value, key)
    // refresh icon cache
    const url = await window.api.attrs.filmIconDataUrl(key, 64) as string | null
    if (url) mergeFilmIconCache({ [key]: url })
    const vals = await window.api.attrs.listValues(selectedTypeId!) as AttributeValue[]
    setAttrValues(vals)
    onAttrChange()
  }

  const handleImportProfile = async () => {
    const imported = await window.api.library.importProfile() as string[]
    if (imported.length > 0) {
      message.success(`已导入 ${imported.length} 个配置文件`)
      loadProfiles()
    }
  }

  const selectedType = attrTypes.find((t) => t.id === selectedTypeId)
  const isFilmType = selectedType?.key === 'film'

  return (
    <Modal
      title="设置"
      open={open}
      onCancel={onClose}
      footer={null}
      width={680}
      styles={{
        content: { background: '#1a1a1a', border: '1px solid #252525' },
        header: { background: '#1a1a1a', borderBottom: '1px solid #252525' }
      }}
    >
      <Tabs
        defaultActiveKey="attrs"
        items={[
          {
            key: 'attrs',
            label: '属性管理',
            children: (
              <div style={{ display: 'flex', gap: 16, height: 460 }}>
                {/* 属性类型列表 */}
                <div style={{ width: 220, borderRight: '1px solid #252525', paddingRight: 16 }}>
                  <div style={{ color: '#888', fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                    属性类别
                  </div>
                  <div style={{ overflowY: 'auto', maxHeight: 360 }}>
                    {attrTypes.map((type) => (
                      <div
                        key={type.id}
                        onClick={() => setSelectedTypeId(type.id)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 4,
                          cursor: 'pointer',
                          background: selectedTypeId === type.id ? '#2a2a2a' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 2
                        }}
                      >
                        {editingTypeId === type.id ? (
                          <Input
                            size="small"
                            value={editingTypeName}
                            onChange={(e) => setEditingTypeName(e.target.value)}
                            onPressEnter={() => handleRenameType(type.id)}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                            style={{ flex: 1, marginRight: 4 }}
                          />
                        ) : (
                          <span style={{ color: type.is_active ? '#ccc' : '#555', flex: 1, fontSize: 13 }}>
                            {type.display_name}
                            {type.is_system ? (
                              <LockOutlined style={{ marginLeft: 4, fontSize: 10, color: '#555' }} />
                            ) : null}
                          </span>
                        )}
                        <Space size={2} onClick={(e) => e.stopPropagation()}>
                          {!type.is_system && (
                            <>
                              <Switch
                                size="small"
                                checked={!!type.is_active}
                                onChange={(v) => handleToggleType(type.id, v)}
                              />
                              {editingTypeId === type.id ? (
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<CheckOutlined />}
                                  onClick={() => handleRenameType(type.id)}
                                />
                              ) : (
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<EditOutlined />}
                                  onClick={() => { setEditingTypeId(type.id); setEditingTypeName(type.display_name) }}
                                />
                              )}
                              <Popconfirm
                                title="删除此属性类别？"
                                onConfirm={() => handleDeleteType(type.id)}
                                okText="删除"
                                cancelText="取消"
                              >
                                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </>
                          )}
                        </Space>
                      </div>
                    ))}
                  </div>
                  <Divider style={{ borderColor: '#252525', margin: '8px 0' }} />
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      size="small"
                      placeholder="新属性名称"
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      onPressEnter={handleAddType}
                    />
                    <Button size="small" icon={<PlusOutlined />} onClick={handleAddType} style={{ background: '#c8832a', borderColor: '#c8832a', color: '#fff' }} />
                  </Space.Compact>
                </div>

                {/* 属性值列表 */}
                <div style={{ flex: 1 }}>
                  {selectedType ? (
                    <>
                      <div style={{ color: '#888', fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                        {selectedType.display_name} 的可选值
                      </div>
                      <div style={{ overflowY: 'auto', maxHeight: 360 }}>
                        {attrValues.length === 0 && (
                          <Empty description={<span style={{ color: '#555' }}>暂无预设值</span>} />
                        )}
                        {attrValues.map((v) => (
                          <div
                            key={v.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '5px 0',
                              borderBottom: '1px solid #222'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                              {isFilmType && (
                                <Tooltip title={v.icon_key ? '更换图标' : '添加图标'}>
                                  <div
                                    onClick={() => handleChangeIcon(v)}
                                    style={{
                                      width: 28,
                                      height: 28,
                                      borderRadius: 4,
                                      background: '#1e1e1e',
                                      border: '1px dashed #333',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer',
                                      flexShrink: 0,
                                      overflow: 'hidden'
                                    }}
                                  >
                                    {v.icon_key ? (
                                      <FilmIconImg iconKey={v.icon_key} size={28} />
                                    ) : (
                                      <PictureOutlined style={{ color: '#444', fontSize: 12 }} />
                                    )}
                                  </div>
                                </Tooltip>
                              )}
                              {editingValueId === v.id ? (
                                <Input
                                  size="small"
                                  value={editingValueName}
                                  onChange={(e) => setEditingValueName(e.target.value)}
                                  onPressEnter={() => handleRenameValue(v.id)}
                                  autoFocus
                                  style={{ flex: 1, marginRight: 8 }}
                                />
                              ) : (
                                <span style={{ color: '#bbb', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {v.value}
                                  {v.is_preset ? (
                                    <Tag style={{ marginLeft: 6, fontSize: 9 }} color="default">预设</Tag>
                                  ) : null}
                                </span>
                              )}
                            </div>
                            <Space size={2}>
                              {editingValueId === v.id ? (
                                <Button size="small" type="text" icon={<CheckOutlined />} onClick={() => handleRenameValue(v.id)} />
                              ) : (
                                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => { setEditingValueId(v.id); setEditingValueName(v.value) }} />
                              )}
                              <Popconfirm title="删除此值？" onConfirm={() => handleDeleteValue(v.id)} okText="删除" cancelText="取消">
                                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </Space>
                          </div>
                        ))}
                      </div>
                      <Divider style={{ borderColor: '#252525', margin: '8px 0' }} />
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          size="small"
                          placeholder="新增选项..."
                          value={newValueName}
                          onChange={(e) => setNewValueName(e.target.value)}
                          onPressEnter={handleAddValue}
                        />
                        <Button size="small" icon={<PlusOutlined />} onClick={handleAddValue} style={{ background: '#c8832a', borderColor: '#c8832a', color: '#fff' }} />
                      </Space.Compact>
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', paddingTop: 80, color: '#555' }}>
                      从左侧选择一个属性类别
                    </div>
                  )}
                </div>
              </div>
            )
          },
          {
            key: 'profiles',
            label: '色彩配置文件',
            children: (
              <div>
                <div style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
                  用于 RAW 文件全屏预览时的色彩空间转换。预设配置文件已内置，可导入自定义 ICC/ICM 文件。
                </div>
                <Button
                  icon={<ImportOutlined />}
                  onClick={handleImportProfile}
                  style={{ marginBottom: 12, background: '#1e1e1e', borderColor: '#333', color: '#ccc' }}
                >
                  导入 ICC/ICM 文件
                </Button>
                <List
                  size="small"
                  dataSource={profiles}
                  renderItem={(p) => (
                    <List.Item>
                      <span style={{ color: '#ccc' }}>{p.name}</span>
                      {p.isPreset && <Tag>内置</Tag>}
                    </List.Item>
                  )}
                  style={{ background: '#1e1e1e', borderRadius: 6 }}
                />
              </div>
            )
          }
        ]}
      />
    </Modal>
  )
}
