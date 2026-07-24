/**
 * Generic attribute library modal — reusable for camera, lens, dev_lab, etc.
 * Shows all values for a given attribute type key, with photo counts and delete/add.
 * Supports per-value alias editing and JSON bulk import.
 */
import React, { useEffect, useState, useCallback } from 'react'
import { Modal, Button, Input, Space, Popconfirm, Empty, Spin, message, Tag, Tooltip } from 'antd'
import { PlusOutlined, DeleteOutlined, ImportOutlined, TagsOutlined } from '@ant-design/icons'
import type { AttributeType, AttributeValue } from '../../types'

interface AttrLibraryModalProps {
  open: boolean
  attrKey: string       // e.g. 'camera' | 'lens'
  title: string         // modal title, e.g. '相机库'
  attrTypes: AttributeType[]
  onClose: () => void
  onChanged: () => void
}

interface AliasItem { id: number; alias: string }

export default function AttrLibraryModal({ open, attrKey, title, attrTypes, onClose, onChanged }: AttrLibraryModalProps) {
  const [values, setValues] = useState<AttributeValue[]>([])
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  // alias management
  const [aliasMap, setAliasMap] = useState<Record<number, AliasItem[]>>({})
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [aliasInput, setAliasInput] = useState('')
  const [addingAlias, setAddingAlias] = useState(false)

  // json import
  const [importingJson, setImportingJson] = useState(false)

  const attrType = attrTypes.find((t) => t.key === attrKey)

  const load = useCallback(async () => {
    if (!attrType) return
    setLoading(true)
    try {
      const vals = await window.api.attrs.listValues(attrType.id) as AttributeValue[]
      setValues(vals)

      const rawCounts = await window.api.attrs.valueCounts({}) as { attribute_type_id: number; attribute_value_id: number; count: number }[]
      const map: Record<number, number> = {}
      rawCounts
        .filter((r) => r.attribute_type_id === attrType.id)
        .forEach((r) => { map[r.attribute_value_id] = r.count })
      setCounts(map)
    } finally {
      setLoading(false)
    }
  }, [attrType?.id])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  useEffect(() => {
    if (!open) {
      setNewName('')
      setExpandedId(null)
      setAliasMap({})
      setAliasInput('')
    }
  }, [open])

  const loadAliases = async (valueId: number) => {
    const items = await window.api.attrs.listAliases(valueId) as AliasItem[]
    setAliasMap((prev) => ({ ...prev, [valueId]: items }))
  }

  const handleToggleExpand = async (valueId: number) => {
    if (expandedId === valueId) {
      setExpandedId(null)
      setAliasInput('')
    } else {
      setExpandedId(valueId)
      setAliasInput('')
      if (!aliasMap[valueId]) await loadAliases(valueId)
    }
  }

  const handleAddAlias = async (valueId: number) => {
    const text = aliasInput.trim()
    if (!text) return
    setAddingAlias(true)
    try {
      const newId = await window.api.attrs.addAlias(valueId, text) as number | null
      if (newId) {
        setAliasMap((prev) => ({
          ...prev,
          [valueId]: [...(prev[valueId] ?? []), { id: newId, alias: text }]
        }))
        setAliasInput('')
      } else {
        message.warning('该别名已存在')
      }
    } finally {
      setAddingAlias(false)
    }
  }

  const handleRemoveAlias = async (valueId: number, aliasId: number) => {
    await window.api.attrs.removeAlias(aliasId)
    setAliasMap((prev) => ({
      ...prev,
      [valueId]: (prev[valueId] ?? []).filter((a) => a.id !== aliasId)
    }))
  }

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name || !attrType) return
    setSaving(true)
    try {
      await window.api.attrs.addValue(attrType.id, name)
      message.success(`已添加`)
      setNewName('')
      onChanged()
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    await window.api.attrs.deleteValue(id)
    onChanged()
    load()
  }

  const handleImportJson = async () => {
    if (!attrType) return
    setImportingJson(true)
    try {
      const result = await window.api.attrs.importJson(attrType.id) as
        | { added: number; updated: number; aliasesAdded: number }
        | { error: string }
        | null
      if (!result) return
      if ('error' in result) { message.error(result.error); return }
      message.success(`导入完成：新增 ${result.added} 项，更新 ${result.updated} 项，别名 +${result.aliasesAdded}`)
      onChanged()
      load()
    } finally {
      setImportingJson(false)
    }
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      footer={
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Button
            icon={<ImportOutlined />}
            loading={importingJson}
            onClick={handleImportJson}
            style={{ background: '#1a1a1a', borderColor: '#444', color: '#aaa' }}
          >
            导入 JSON
          </Button>
          <Space.Compact style={{ flex: 1 }}>
            <Input
              placeholder={`新增${title.replace('库', '')}名称...`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onPressEnter={handleAdd}
              style={{ background: '#222', borderColor: '#333', color: '#ccc' }}
            />
            <Button
              icon={<PlusOutlined />}
              loading={saving}
              disabled={!newName.trim()}
              onClick={handleAdd}
              style={{ background: '#c8832a', borderColor: '#c8832a', color: '#fff' }}
            >
              添加
            </Button>
          </Space.Compact>
        </Space>
      }
      width={480}
      mask={false}
      styles={{
        content: { background: '#1a1a1a', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)' },
        header: { background: '#1a1a1a', borderBottom: '1px solid #252525' },
        footer: { background: '#1a1a1a', borderTop: '1px solid #252525', padding: '12px 16px' },
        body: { padding: '12px 16px', maxHeight: 460, overflowY: 'auto' }
      }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
      ) : values.length === 0 ? (
        <Empty description={<span style={{ color: '#555' }}>暂无数据</span>} />
      ) : (
        values.map((v) => {
          const isExpanded = expandedId === v.id
          const aliases = aliasMap[v.id] ?? []
          return (
            <div
              key={v.id}
              style={{
                borderRadius: 6, background: '#111',
                border: `1px solid ${isExpanded ? '#c8832a55' : '#222'}`,
                marginBottom: 6, overflow: 'hidden'
              }}
            >
              {/* Main row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#ddd', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.value}</div>
                  <div style={{ color: '#555', fontSize: 11, marginTop: 1 }}>{counts[v.id] ?? 0} 张照片</div>
                </div>
                {/* Alias toggle */}
                <Tooltip title={isExpanded ? '收起别名' : '编辑别名'}>
                  <Button
                    size="small" type="text"
                    icon={<TagsOutlined />}
                    onClick={() => handleToggleExpand(v.id)}
                    style={{ color: isExpanded ? '#c8832a' : '#555' }}
                  />
                </Tooltip>
                {/* Delete */}
                <Popconfirm
                  title={`删除"${v.value}"？`}
                  description="照片中的该属性将被清除"
                  onConfirm={() => handleDelete(v.id)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" type="text" icon={<DeleteOutlined />} style={{ color: '#555' }} />
                </Popconfirm>
              </div>

              {/* Alias editor (expanded) */}
              {isExpanded && (
                <div style={{ padding: '6px 10px 10px', borderTop: '1px solid #1e1e1e' }}>
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
                    别名用于文件夹名称匹配（如中文名、缩写）
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: aliases.length > 0 ? 8 : 0 }}>
                    {aliases.map((a) => (
                      <Tag
                        key={a.id}
                        closable
                        onClose={() => handleRemoveAlias(v.id, a.id)}
                        style={{ background: '#1e1e1e', borderColor: '#c8832a55', color: '#c8832a', fontSize: 11 }}
                      >
                        {a.alias}
                      </Tag>
                    ))}
                  </div>
                  <Space.Compact size="small" style={{ width: '100%' }}>
                    <Input
                      placeholder="添加别名（如：佳能EOS5D）"
                      value={aliasInput}
                      onChange={(e) => setAliasInput(e.target.value)}
                      onPressEnter={() => handleAddAlias(v.id)}
                      style={{ background: '#1e1e1e', borderColor: '#2a2a2a', color: '#ccc', fontSize: 12 }}
                    />
                    <Button
                      icon={<PlusOutlined />}
                      loading={addingAlias}
                      disabled={!aliasInput.trim()}
                      onClick={() => handleAddAlias(v.id)}
                      style={{ background: '#c8832a', borderColor: '#c8832a', color: '#fff' }}
                    />
                  </Space.Compact>
                </div>
              )}
            </div>
          )
        })
      )}
    </Modal>
  )
}
