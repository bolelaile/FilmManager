import React, { useEffect, useRef } from 'react'
import { Progress } from 'antd'
import { LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { useLibraryStore } from '../../store'

/**
 * 全局后台导入进度条：固定在内容区底部，后台处理过程中持续可见。
 * 所有阶段完成后自动在 2 秒后消失。
 */
export default function ImportProgressBar() {
  const { importProgress, setImportProgress } = useLibraryStore()
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const total = importProgress?.total ?? 0
  const imported = importProgress?.imported ?? 0
  const skipped = importProgress?.skipped ?? 0
  const done = imported + skipped
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  const isFinished = total > 0 && done >= total

  // 完成后 2 秒自动隐藏
  useEffect(() => {
    if (isFinished) {
      hideTimerRef.current = setTimeout(() => {
        setImportProgress(null)
      }, 2000)
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [isFinished, setImportProgress])

  if (!importProgress) return null

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        background: '#1a1a1a',
        borderTop: '1px solid #2a2a2a',
        padding: '7px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 -2px 12px rgba(0,0,0,0.4)'
      }}
    >
      {/* 状态图标 */}
      {isFinished ? (
        imported > 0
          ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 14, flexShrink: 0 }} />
          : <CloseCircleOutlined style={{ color: '#888', fontSize: 14, flexShrink: 0 }} />
      ) : (
        <LoadingOutlined style={{ color: '#c8832a', fontSize: 14, flexShrink: 0 }} />
      )}

      {/* 进度文字 */}
      <div style={{ flexShrink: 0, minWidth: 0 }}>
        {isFinished ? (
          <span style={{ color: '#aaa', fontSize: 12 }}>
            导入完成 — 已导入 {imported} 张{skipped > 0 ? `，跳过 ${skipped} 张` : ''}
          </span>
        ) : (
          <span style={{ color: '#aaa', fontSize: 12 }}>
            正在导入&ensp;
            <span style={{ color: '#c8832a', fontWeight: 500 }}>{done}</span>
            <span style={{ color: '#555' }}> / {total}</span>
            {skipped > 0 && <span style={{ color: '#555' }}>，已跳过 {skipped}</span>}
          </span>
        )}
      </div>

      {/* 进度条 */}
      <Progress
        percent={percent}
        size="small"
        showInfo={false}
        strokeColor={isFinished ? (imported > 0 ? '#52c41a' : '#555') : '#c8832a'}
        trailColor="#2a2a2a"
        style={{ flex: 1, margin: 0 }}
      />

      {/* 百分比 */}
      <span style={{ color: '#555', fontSize: 11, flexShrink: 0, minWidth: 32, textAlign: 'right' }}>
        {percent}%
      </span>
    </div>
  )
}
