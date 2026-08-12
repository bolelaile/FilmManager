import React, { useState } from 'react'
import { Modal, Input, Space, Button, message } from 'antd'
import { BlockOutlined, WarningOutlined } from '@ant-design/icons'
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

  const doCreate = async () => {
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

  const handleCreate = async () => {
    if (selectedIds.length === 0) {
      message.warning('请先选择照片')
      return
    }

    // 属性一致性检查
    const check = await window.api.rolls.checkAttrConsistency(selectedIds) as { ok: boolean; warnings: string[] }
    if (!check.ok) {
      Modal.confirm({
        title: (
          <Space>
            <WarningOutlined style={{ color: '#faad14' }} />
            属性不一致
          </Space>
        ),
        content: (
          <div style={{ paddingTop: 8 }}>
            <div style={{ color: '#aaa', marginBottom: 8 }}>所选照片存在以下属性不一致：</div>
            {check.warnings.map((w, i) => (
              <div key={i} style={{ color: '#faad14', marginBottom: 4 }}>• {w}</div>
            ))}
            <div style={{ color: '#888', marginTop: 12, fontSize: 12 }}>建议同一卷内照片使用相同胶卷与相机，是否仍要继续建卷？</div>
          </div>
        ),
        okText: '仍然建卷',
        cancelText: '取消',
        okButtonProps: { style: { background: '#c8832a', borderColor: '#c8832a' } },
        styles: {
          content: { background: '#1a1a1a', border: '1px solid #353535' },
          header: { background: '#1a1a1a', borderBottom: '1px solid #252525' }
        },
        mask: false,
        onOk: doCreate
      })
      return
    }

    await doCreate()
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
        content: { background: '#1a1a1a', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)', borderRadius: 8 },
        header: { background: '#1a1a1a', borderBottom: '1px solid #252525', borderRadius: '8px 8px 0 0' },
        footer: { background: '#1a1a1a', borderTop: '1px solid #252525', padding: '12px 20px', borderRadius: '0 0 8px 8px' }
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
