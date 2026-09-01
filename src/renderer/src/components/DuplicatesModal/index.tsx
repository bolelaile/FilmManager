/**
 * 重复照片管理弹窗。
 * 按 content_hash 分组展示重复照片，支持"保留最新/最旧/最大，其余移入回收站"与单张移入回收站。
 * 复用 photos.listDuplicates / photos.delete（软删，与回收站联动）。
 */
import { useEffect, useState, useCallback } from 'react'
import { Modal, Button, Empty, Spin, message, Tooltip, Tag } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'

interface DupPhoto {
  id: number
  file_path: string
  original_name: string
  file_type: string
  file_size?: number
  imported_at: string
  thumb_path?: string
  thumb_ready: number
  rotation: number
}

interface DupGroup {
  content_hash: string
  count: number
  photos: DupPhoto[]
}

interface Props {
  open: boolean
  onClose: () => void
  onChanged: () => void
}

function fmtSize(bytes?: number): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function DuplicatesModal({ open, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(false)
  const [groups, setGroups] = useState<DupGroup[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.api.photos.listDuplicates() as DupGroup[] | null
      setGroups(res ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (open) load() }, [open, load])

  const softDelete = async (ids: number[]) => {
    if (ids.length === 0) return
    await window.api.photos.delete(ids, false)
    message.success(`已移入回收站 ${ids.length} 张`)
    onChanged()
    load()
  }

  /** 保留策略：保留指定排序的第一张，其余移入回收站 */
  const keepOne = async (group: DupGroup, sortKey: 'newest' | 'oldest' | 'largest') => {
    const sorted = [...group.photos].sort((a, b) => {
      if (sortKey === 'largest') return (b.file_size ?? 0) - (a.file_size ?? 0)
      // newest: imported_at desc；oldest: asc
      return sortKey === 'newest'
        ? (b.imported_at || '').localeCompare(a.imported_at || '')
        : (a.imported_at || '').localeCompare(b.imported_at || '')
    })
    const keep = sorted[0]
    const remove = sorted.slice(1).map((p) => p.id)
    await softDelete(remove)
    message.success(`已保留 ${keep.original_name}，其余 ${remove.length} 张移入回收站`)
  }

  return (
    <Modal
      title="重复照片"
      open={open}
      onCancel={onClose}
      width={960}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <Spin spinning={loading}>
        {groups.length === 0 && !loading ? (
          <Empty description="未发现重复照片" />
        ) : (
          <div style={{ maxHeight: '64vh', overflowY: 'auto' }}>
            {groups.map((g) => (
              <div key={g.content_hash} style={{ marginBottom: 18, borderBottom: '1px solid #252525', paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Tag color="orange">{g.count} 张重复</Tag>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button size="small" onClick={() => keepOne(g, 'newest')}>保留最新</Button>
                    <Button size="small" onClick={() => keepOne(g, 'oldest')}>保留最旧</Button>
                    <Button size="small" onClick={() => keepOne(g, 'largest')}>保留最大</Button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {g.photos.map((p) => {
                    const url = p.thumb_path && p.thumb_ready ? `localfile://${encodeURIComponent(p.thumb_path)}` : null
                    return (
                      <div key={p.id} style={{ width: 130, position: 'relative' }}>
                        <div style={{ width: 130, height: 130, background: '#1f1f1f', borderRadius: 6, overflow: 'hidden' }}>
                          {url
                            ? <img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={p.original_name} />
                            : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555', fontSize: 11 }}>无缩略图</div>}
                        </div>
                        <div style={{ fontSize: 11, color: '#aaa', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <Tooltip title={p.file_path}>{p.original_name}</Tooltip>
                        </div>
                        <div style={{ fontSize: 10, color: '#666' }}>{fmtSize(p.file_size)} · {p.imported_at?.slice(0, 10)}</div>
                        <Tooltip title="移入回收站">
                          <Button size="small" danger icon={<DeleteOutlined />} style={{ position: 'absolute', top: 4, right: 4 }} onClick={() => softDelete([p.id])} />
                        </Tooltip>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Spin>
    </Modal>
  )
}
