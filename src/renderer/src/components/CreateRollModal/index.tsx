import React, { useState } from 'react'
import { Modal, Input, Space, Button, message } from 'antd'
import { BlockOutlined } from '@ant-design/icons'
import { useStore } from '../../store'

interface CreateRollModalProps {
  open: boolean
  selectedIds: number[]
  onClose: () => void
  onCreated: (rollId: number) => void
}

export default function CreateRollModal({ open, selectedIds, onClose, onCreated }: CreateRollModalProps) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const { filter } = useStore()

  const handleCreate = async () => {
    if (selectedIds.length === 0) {
      message.warning('请先选择照片')
      return
    }
    setSaving(true)
    try {
      const rollId = await window.api.rolls.create({
        photoIds: selectedIds,
        name: name.trim() || undefined,
        subLibraryId: filter.subLibraryId ?? null
      }) as number
      message.success(`已建卷，包含 ${selectedIds.length} 张照片`)
      setName('')
      onCreated(rollId)
    } catch (err) {
      message.error('建卷失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={
        <Space>
          <BlockOutlined style={{ color: '#c8832a' }} />
          建立胶卷卷
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={saving}
            onClick={handleCreate}
            style={{ background: '#c8832a', borderColor: '#c8832a' }}
          >
            建立（{selectedIds.length} 张照片）
          </Button>
        </Space>
      }
      width={440}
      mask={false}
      styles={{
        content: { background: '#1a1a1a', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)' },
        header: { background: '#1a1a1a', borderBottom: '1px solid #252525' },
        footer: { background: '#1a1a1a', borderTop: '1px solid #252525' }
      }}
    >
      <Space direction="vertical" style={{ width: '100%', paddingTop: 8 }}>
        <div style={{ color: '#888', fontSize: 12 }}>
          将所选 {selectedIds.length} 张照片建立为一卷。留空则按"胶片类型-胶片格式-日期"自动命名。
        </div>
        <Input
          placeholder="卷名称（可留空自动生成）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={handleCreate}
          autoFocus
          style={{ background: '#222', borderColor: '#333', color: '#ccc' }}
        />
      </Space>
    </Modal>
  )
}
