/**
 * 回收站弹窗。
 * 列出软删照片（photos:listTrash），支持恢复 / 彻底删除 / 清空回收站。
 * 复用 localfile:// 协议渲染缩略图（与 PhotoCard 一致）。
 */
import { useEffect, useState, useCallback } from 'react'
import { Modal, Button, Empty, Spin, message, Popconfirm, Tooltip } from 'antd'
import { DeleteOutlined, UndoOutlined, DeleteFilled } from '@ant-design/icons'
import type { PhotoAttribute } from '../../types'

interface TrashPhoto {
  id: number
  file_path: string
  original_name: string
  file_type: string
  thumb_path?: string
  thumb_ready: number
  rotation: number
  imported_at: string
  deleted_at?: string | null
  attributes: PhotoAttribute[]
}

interface Props {
  open: boolean
  onClose: () => void
}

const PAGE_SIZE = 50

export default function TrashModal({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [photos, setPhotos] = useState<TrashPhoto[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const res = await window.api.photos.listTrash({ page: p, pageSize: PAGE_SIZE }) as
        { total: number; rows: TrashPhoto[] } | null
      if (res) {
        setPhotos(res.rows)
        setTotal(res.total)
        setPage(p)
        setSelected(new Set())
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load(1)
  }, [open, load])

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleRestore = async (ids: number[]) => {
    if (ids.length === 0) return
    await window.api.photos.restore(ids)
    message.success(`已恢复 ${ids.length} 张照片`)
    load(page)
  }

  const handlePurge = async (ids: number[]) => {
    if (ids.length === 0) return
    await window.api.photos.purge(ids)
    message.success(`已彻底删除 ${ids.length} 张照片`)
    load(page)
  }

  const handleEmpty = async () => {
    const res = await window.api.photos.emptyTrash() as { purged: number } | null
    message.success(`已清空回收站（${res?.purged ?? 0} 张）`)
    load(1)
  }

  const selectedIds = [...selected]

  return (
    <Modal
      title={`回收站${total > 0 ? `（${total} 张）` : ''}`}
      open={open}
      onCancel={onClose}
      width={900}
      footer={[
        <Button key="close" onClick={onClose}>关闭</Button>,
        <Popconfirm
          key="empty"
          title="清空回收站？"
          description="将永久删除回收站中的全部照片，无法恢复。"
          okText="清空"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={handleEmpty}
          disabled={total === 0}
        >
          <Button danger icon={<DeleteFilled />} disabled={total === 0}>清空回收站</Button>
        </Popconfirm>,
      ]}
    >
      {selectedIds.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
          <span style={{ alignSelf: 'center' }}>已选 {selectedIds.length} 张：</span>
          <Button icon={<UndoOutlined />} onClick={() => handleRestore(selectedIds)}>恢复</Button>
          <Popconfirm title={`彻底删除 ${selectedIds.length} 张？`} okText="彻底删除" okButtonProps={{ danger: true }} cancelText="取消" onConfirm={() => handlePurge(selectedIds)}>
            <Button danger icon={<DeleteOutlined />}>彻底删除</Button>
          </Popconfirm>
        </div>
      )}

      <Spin spinning={loading}>
        {photos.length === 0 && !loading ? (
          <Empty description="回收站为空" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, maxHeight: '60vh', overflowY: 'auto' }}>
            {photos.map((p) => {
              const thumbUrl = p.thumb_path && p.thumb_ready
                ? `localfile://${encodeURIComponent(p.thumb_path)}`
                : null
              const isSel = selected.has(p.id)
              return (
                <div
                  key={p.id}
                  onClick={() => toggleSelect(p.id)}
                  style={{
                    position: 'relative', cursor: 'pointer', border: `2px solid ${isSel ? 'var(--primary, #c8832a)' : 'var(--border, #333)'}`,
                    borderRadius: 6, overflow: 'hidden', aspectRatio: '1', background: '#1f1f1f'
                  }}
                >
                  {thumbUrl
                    ? <img src={thumbUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={p.original_name} />
                    : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>无缩略图</div>}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, padding: '2px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <Tooltip title={p.original_name}>{p.original_name}</Tooltip>
                  </div>
                  <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="恢复">
                      <Button size="small" type="primary" ghost icon={<UndoOutlined />} onClick={() => handleRestore([p.id])} />
                    </Tooltip>
                    <Popconfirm title="彻底删除？" okText="删除" okButtonProps={{ danger: true }} cancelText="取消" onConfirm={() => handlePurge([p.id])}>
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Spin>

      {total > PAGE_SIZE && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Button disabled={page <= 1} onClick={() => load(page - 1)}>上一页</Button>
          <span style={{ margin: '0 12px' }}>第 {page} 页 / 共 {Math.ceil(total / PAGE_SIZE)} 页</span>
          <Button disabled={page * PAGE_SIZE >= total} onClick={() => load(page + 1)}>下一页</Button>
        </div>
      )}
    </Modal>
  )
}
