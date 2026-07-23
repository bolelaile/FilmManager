import React, { useEffect, useState, useCallback } from 'react'
import { Modal, Button, Space, Input, Select, Divider, Popconfirm, Empty, Spin, message } from 'antd'
import { PlusOutlined, DeleteOutlined, PictureOutlined } from '@ant-design/icons'
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

  const filmType = attrTypes.find((t) => t.key === 'film')

  const load = useCallback(async () => {
    if (!filmType) return
    setLoading(true)
    try {
      const vals = await window.api.attrs.listValues(filmType.id) as AttributeValue[]
      setFilmValues(vals)

      // load icon cache for all film values
      const needed = vals.filter((v) => v.icon_key && !filmIconCache[v.icon_key]).map((v) => v.icon_key!)
      if (needed.length > 0) {
        const batches: string[][] = []
        for (let i = 0; i < needed.length; i += 20) batches.push(needed.slice(i, i + 20))
        const results = await Promise.all(batches.map((b) => window.api.attrs.filmIconsBatch(b, 64)))
        const merged: Record<string, string> = {}
        results.forEach((r) => Object.assign(merged, r))
        mergeFilmIconCache(merged)
      }

      // get photo counts per film value
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

  // reset add form when closed
  useEffect(() => {
    if (!addOpen) {
      setNewName('')
      setNewSpec(null)
      setNewIconKey(null)
      setNewIconUrl(null)
    }
  }, [addOpen])

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

  return (
    <>
      <Modal
        title="胶卷库"
        open={open}
        onCancel={onClose}
        footer={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setAddOpen(true)}
            style={{ background: '#c8832a', borderColor: '#c8832a' }}
          >
            新增胶卷
          </Button>
        }
        width={560}
        mask={false}
        draggable
        styles={{
          content: { background: '#1a1a1a', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)' },
          header: { background: '#1a1a1a', borderBottom: '1px solid #252525' },
          footer: { background: '#1a1a1a', borderTop: '1px solid #252525' },
          body: { padding: '12px 16px', maxHeight: 460, overflowY: 'auto' }
        }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
        ) : filmValues.length === 0 ? (
          <Empty description={<span style={{ color: '#555' }}>暂无胶卷类型</span>} />
        ) : (
          filmValues.map((v) => {
            const iconUrl = v.icon_key ? filmIconCache[v.icon_key] : null
            return (
              <div
                key={v.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 6,
                  background: '#111', border: '1px solid #222',
                  marginBottom: 6
                }}
              >
                {/* icon */}
                <div style={{ width: 40, height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: '#1e1e1e', overflow: 'hidden' }}>
                  {iconUrl
                    ? <img src={iconUrl} alt="" width={40} height={40} style={{ objectFit: 'cover', borderRadius: 6 }} />
                    : <PictureOutlined style={{ color: '#444', fontSize: 18 }} />
                  }
                </div>
                {/* name + count */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#ddd', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.value}</div>
                  <div style={{ color: '#555', fontSize: 11, marginTop: 1 }}>{counts[v.id] ?? 0} 张照片</div>
                </div>
                {/* delete */}
                <Popconfirm
                  title="删除胶卷类型？"
                  description="照片中的该属性将被清除"
                  onConfirm={() => handleDelete(v.id)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    size="small"
                    type="text"
                    icon={<DeleteOutlined />}
                    style={{ color: '#555' }}
                  />
                </Popconfirm>
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
        draggable
        styles={{
          content: { background: '#1a1a1a', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)' },
          header: { background: '#1a1a1a', borderBottom: '1px solid #252525' },
          footer: { background: '#1a1a1a', borderTop: '1px solid #252525' }
        }}
      >
        <Space direction="vertical" style={{ width: '100%', marginTop: 8 }} size={12}>
          {/* 名称 */}
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

          {/* 规格 */}
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

          {/* 图标（可选） */}
          <div>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>胶卷图标（可选）</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                onClick={handlePickIcon}
                style={{
                  width: 56, height: 56, background: '#1e1e1e',
                  border: '1px dashed #444', borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', flexShrink: 0, overflow: 'hidden'
                }}
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
                  <Button size="small" type="text" onClick={() => { setNewIconKey(null); setNewIconUrl(null) }}
                    style={{ color: '#666', padding: 0, fontSize: 11 }}>
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
