/**
 * Generic attribute library modal — reusable for camera, lens, dev_lab, etc.
 * Shows all values for a given attribute type key, with photo counts and delete/add.
 */
import React, { useEffect, useState, useCallback } from 'react'
import { Modal, Button, Input, Space, Popconfirm, Empty, Spin, message } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import type { AttributeType, AttributeValue } from '../../types'

interface AttrLibraryModalProps {
  open: boolean
  attrKey: string       // e.g. 'camera' | 'lens'
  title: string         // modal title, e.g. '相机库'
  attrTypes: AttributeType[]
  onClose: () => void
  onChanged: () => void
}

export default function AttrLibraryModal({ open, attrKey, title, attrTypes, onClose, onChanged }: AttrLibraryModalProps) {
  const [values, setValues] = useState<AttributeValue[]>([])
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

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
    if (!open) setNewName('')
  }, [open])

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

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      footer={
        <Space.Compact style={{ width: '100%' }}>
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
      }
      width={480}
      mask={false}
      draggable
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
        values.map((v) => (
          <div
            key={v.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 6,
              background: '#111', border: '1px solid #222',
              marginBottom: 6
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#ddd', fontSize: 13 }}>{v.value}</div>
              <div style={{ color: '#555', fontSize: 11, marginTop: 1 }}>{counts[v.id] ?? 0} 张照片</div>
            </div>
            <Popconfirm
              title={`删除"${v.value}"？`}
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
        ))
      )}
    </Modal>
  )
}
