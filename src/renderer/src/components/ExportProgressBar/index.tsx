import React from 'react'
import { Progress, Button } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { useUIStore } from '../../store'

export default function ExportProgressBar() {
  const { exportProgress, setExportProgress } = useUIStore()
  if (!exportProgress) return null
  const { done, total, success, failed } = exportProgress
  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div style={{
      position: 'fixed', top: 16, right: 24, zIndex: 4000,
      width: 320, padding: '14px 16px',
      background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)',
      borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.6)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <DownloadOutlined style={{ color: 'var(--accent)' }} />
        <span style={{ color: 'var(--text-primary)', fontSize: 13, flex: 1 }}>导出中 {done}/{total}</span>
        <Button size="small" type="text" onClick={() => window.api.export.cancel()} style={{ color: 'var(--text-dim)', fontSize: 12 }}>取消</Button>
      </div>
      <Progress percent={percent} size="small" strokeColor="var(--accent)" />
      <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 4 }}>
        成功 {success} · 失败 {failed}
      </div>
      {done >= total && (
        <div style={{ marginTop: 6, textAlign: 'right' }}>
          <Button size="small" type="link" onClick={() => setExportProgress(null)}>关闭</Button>
        </div>
      )}
    </div>
  )
}
