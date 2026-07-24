import React, { useEffect, useState, useCallback } from 'react'
import { Modal, Button, Space, Input, Select, Divider, Popconfirm, Empty, Spin, Tag, Tooltip, message } from 'antd'
import { PlusOutlined, DeleteOutlined, PictureOutlined, ImportOutlined, TagsOutlined } from '@ant-design/icons'
import type { AttributeType, AttributeValue } from '../../types'
import { FilmIconImg } from '../FilmIcon'
import { useStore } from '../../store'

const SPEC_OPTIONS = [
  { value: '135 / 35mm', label: '135 / 35mm' },
  { value: '120 中画幅', label: '120 中画幅' },
  { value: '4×5 大画幅', label: '4×5 大画幅' },
  { value: '8×10 大画幅', label: '8×10 大画幅' }
]

interface FilmLibraryModalProps {
  open: boolean
  attrTypes: AttributeType[]
  onClose: () => void
  onChanged: () => void
}

interface AliasItem { id: number; alias: string }

export default function FilmLibraryModal({ open, attrTypes, onClose, onChanged }: FilmLibraryModalProps) {
  const { filmIconCache, mergeFilmIconCache } = useStore()
  const [filmValues, setFilmValues] = useState<AttributeValue[]>([])
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  // new film form
  const [newName, setNewName] = useState('')
  const [newSpec, setNewSpec] = useState<string | null>(null)
  const [newIconKey, setNewIconKey] = useState<string | null>(null)
  const [newIconUrl, setNewIconUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // alias management
  const [aliasMap, setAliasMap] = useState<Record<number, AliasItem[]>>({})
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [aliasInput, setAliasInput] = useState('')
  const [addingAlias, setAddingAlias] = useState(false)

  // json import
  const [importingJson, setImportingJson] = useState(false)

  const filmType = attrTypes.find((t) => t.key === 'film')

  const load = useCallback(async () => {
    if (!filmType) return
    setLoading(true)
    try {
      const vals = await window.api.attrs.listValues(filmType.id) as AttributeValue[]
      setFilmValues(vals)

      const needed = vals.filter((v) => v.icon_key && !filmIconCache[v.icon_key]).map((v) => v.icon_key!)
      if (needed.length > 0) {
        const batches: string[][] = []
        for (let i = 0; i < needed.length; i += 20) batches.push(needed.slice(i, i + 20))
        const results = await Promise.all(batches.map((b) => window.api.attrs.filmIconsBatch(b, 64)))
        const merged: Record<string, string> = {}
        results.forEach((r) => Object.assign(merged, r))
        mergeFilmIconCache(merged)
      }

      const rawCounts = await window.api.attrs.valueCounts({}) as { attribute_type_id: number; attribute_value_id: number; count: number }[]
      const map: Record<number, number> = {}
      rawCounts
        .filter((r) => r.attribute_type_id === filmType.id)
        .forEach((r) => { map[r.attribute_value_id] = r.count })
      setCounts(map)
    } finally {
      setLoading(false)
    }
  }, [filmType?.id])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  useEffect(() => {
    if (!addOpen) {
      setNewName('')
      setNewSpec(null)
      setNewIconKey(null)
      setNewIconUrl(null)
    }
  }, [addOpen])

  useEffect(() => {
    if (!open) {
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

  const handleDelete = async (id: number) => {
    await window.api.attrs.deleteValue(id)
    onChanged()
    load()
  }

  const handlePickIcon = async () => {
    const key = await window.api.attrs.importCustomIcon() as string | null
    if (!key) return
    const url = await window.api.attrs.filmIconDataUrl(key, 64) as string | null
    if (url) {
      mergeFilmIconCache({ [key]: url })
      setNewIconUrl(url)
    }
    setNewIconKey(key)
  }

  const handleSave = async () => {
    const name = newName.trim()
    if (!name || !newSpec) return
    setSaving(true)
    try {
      const fullName = `${name} [${newSpec}]`
      await window.api.attrs.addValue(filmType!.id, fullName, newIconKey ?? undefined)
      message.success('已添加胶卷')
      setAddOpen(false)
      onChanged()
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleImportJson = async () => {
    if (!filmType) return
    setImportingJson(true)
    try {
      const result = await window.api.attrs.importJson(filmType.id) as
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
    <>
      <Modal
        title="胶卷库"
        open={open}
        onCancel={onClose}
        footer={
          <Space>
            <Button
              icon={<ImportOutlined />}
              loading={importingJson}
              onClick={handleImportJson}
              style={{ background: '#1a1a1a', borderColor: '#444', color: '#aaa' }}
            >
              导入 JSON
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setAddOpen(true)}
              style={{ background: '#c8832a', borderColor: '#c8832a' }}
            >
              新增胶卷
            </Button>
          </Space>
        }
        width={580}
        mask={false}
        styles={{
          content: { background: '#1a1a1a', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)' },
          header: { background: '#1a1a1a', borderBottom: '1px solid #252525' },
          footer: { background: '#1a1a1a', borderTop: '1px solid #252525' },
          body: { padding: '12px 16px', maxHeight: 500, overflowY: 'auto' }
        }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
        ) : filmValues.length === 0 ? (
          <Empty description={<span style={{ color: '#555' }}>暂无胶卷类型</span>} />
        ) : (
          filmValues.map((v) => {
            const iconUrl = v.icon_key ? filmIconCache[v.icon_key] : null
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
                  <div style={{ width: 40, height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: '#1e1e1e', overflow: 'hidden' }}>
                    {iconUrl
                      ? <img src={iconUrl} alt="" width={40} height={40} style={{ objectFit: 'cover', borderRadius: 6 }} />
                      : <PictureOutlined style={{ color: '#444', fontSize: 18 }} />
                    }
                  </div>
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
                    title="删除胶卷类型？"
                    description="照片中的该属性将被清除"
                    onConfirm={() => handleDelete(v.id)}
                    okText="删除" cancelText="取消"
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
                        placeholder="添加别名（如：柯达Portra400）"
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

      {/* 新增胶卷 sub-modal */}
      <Modal
        title="新增胶卷"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ loading: saving, disabled: !newName.trim() || !newSpec, style: { background: '#c8832a', borderColor: '#c8832a' } }}
        width={420}
        mask={false}
        styles={{
          content: { background: '#1a1a1a', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)' },
          header: { background: '#1a1a1a', borderBottom: '1px solid #252525' },
          footer: { background: '#1a1a1a', borderTop: '1px solid #252525' }
        }}
      >
        <Space direction="vertical" style={{ width: '100%', marginTop: 8 }} size={12}>
          <div>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>胶卷名称 <span style={{ color: '#c8832a' }}>*</span></div>
            <Input
              autoFocus
              placeholder="如 Kodak Ultramax 400"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onPressEnter={newSpec ? handleSave : undefined}
              style={{ background: '#222', borderColor: '#333', color: '#ccc' }}
            />
          </div>
          <div>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>胶卷规格 <span style={{ color: '#c8832a' }}>*</span></div>
            <Select
              style={{ width: '100%' }}
              placeholder="选择规格"
              value={newSpec}
              onChange={setNewSpec}
              options={SPEC_OPTIONS}
              styles={{ popup: { root: { background: '#1a1a1a' } } }}
            />
          </div>
          <div>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>胶卷图标（可选）</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                onClick={handlePickIcon}
                style={{ width: 56, height: 56, background: '#1e1e1e', border: '1px dashed #444', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, overflow: 'hidden' }}
              >
                {newIconUrl
                  ? <img src={newIconUrl} alt="" width={56} height={56} style={{ objectFit: 'cover' }} />
                  : <PictureOutlined style={{ fontSize: 20, color: '#444' }} />
                }
              </div>
              <div>
                <Button size="small" onClick={handlePickIcon} style={{ background: '#222', borderColor: '#333', color: '#aaa', display: 'block', marginBottom: 4 }}>
                  {newIconKey ? '更换图标' : '选择图标'}
                </Button>
                {newIconKey && (
                  <Button size="small" type="text" onClick={() => { setNewIconKey(null); setNewIconUrl(null) }} style={{ color: '#666', padding: 0, fontSize: 11 }}>
                    移除图标
                  </Button>
                )}
                <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>支持 JPG、PNG、WebP</div>
              </div>
            </div>
          </div>
        </Space>
      </Modal>
    </>
  )
}
