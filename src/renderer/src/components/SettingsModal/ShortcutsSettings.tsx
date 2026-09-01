/**
 * 快捷键自定义设置（SettingsModal 内嵌）。
 * 点击绑定按钮进入录制态，捕获下一次按键组合 → 规范化 → 冲突检测 → 写入 store + 持久化。
 * 冲突时 message.error 报错并拒绝写入，高亮冲突行。
 */
import { useState, useEffect, useRef } from 'react'
import { Button, message, Tag } from 'antd'
import { UndoOutlined, CloseOutlined } from '@ant-design/icons'
import { useShortcutsStore } from '../../store/shortcutsSlice'
import {
  SHORTCUT_ACTIONS, DEFAULT_BINDINGS, ACTION_BY_ID, findConflicts, ShortcutCategory
} from '../../shortcuts/registry'
import { eventToAccelerator, normalizeBinding, formatBinding } from '../../shortcuts/accelerator'

const CATEGORY_LABEL: Record<ShortcutCategory, string> = {
  '全局': '全局',
  '照片网格': '照片网格（照片视图）',
  '全屏预览': '全屏预览',
}

export default function ShortcutsSettings() {
  const bindings = useShortcutsStore((s) => s.bindings)
  const setBinding = useShortcutsStore((s) => s.setBinding)
  const clearBinding = useShortcutsStore((s) => s.clearBinding)
  const resetAll = useShortcutsStore((s) => s.resetAll)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [conflictId, setConflictId] = useState<string | null>(null)
  const recordingRef = useRef<string | null>(null)
  recordingRef.current = recordingId

  // 录制：监听一次 keydown
  useEffect(() => {
    if (!recordingId) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Escape 取消录制
      if (e.key === 'Escape') { setRecordingId(null); return }
      const acc = eventToAccelerator(e)
      if (!acc) return // 纯修饰键，等待主键
      const id = recordingRef.current
      if (!id) return
      const normalized = normalizeBinding(acc)
      // 冲突检测
      const conflicts = findConflicts(bindings, id, normalized)
      if (conflicts.length > 0) {
        message.error(`绑定冲突：与【${conflicts.join('、')}】重复，已拒绝`)
        setConflictId(id)
        setRecordingId(null)
        setTimeout(() => setConflictId(null), 2000)
        return
      }
      setBinding(id, normalized)
      message.success(`已设置：${ACTION_BY_ID[id]?.description ?? id} → ${formatBinding(normalized)}`)
      setRecordingId(null)
    }
    // 捕获阶段，优先于其它监听
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recordingId, bindings, setBinding])

  const handleReset = async () => {
    await resetAll()
    message.success('已恢复全部默认快捷键')
  }

  // 按类别分组
  const grouped = SHORTCUT_ACTIONS.reduce<Record<string, typeof SHORTCUT_ACTIONS>>((acc, a) => {
    (acc[a.category] ??= []).push(a)
    return acc
  }, {})

  return (
    <div style={{ paddingTop: 8, maxHeight: 460, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ color: '#888', fontSize: 12 }}>点击右侧按钮后按下组合键录制；Esc 取消。冲突将报错拒绝。</span>
        <Button size="small" icon={<UndoOutlined />} onClick={handleReset} style={{ background: '#1e1e1e', borderColor: '#333', color: '#aaa' }}>恢复全部默认</Button>
      </div>
      {Object.entries(grouped).map(([cat, actions]) => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <div style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{CATEGORY_LABEL[cat as ShortcutCategory] ?? cat}</div>
          {actions.map((a) => {
            const b = bindings[a.id] ?? ''
            const isDefault = b === DEFAULT_BINDINGS[a.id]
            const isRecording = recordingId === a.id
            const isConflict = conflictId === a.id
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '5px 8px', borderRadius: 4, marginBottom: 2,
                  background: isConflict ? 'rgba(192,57,43,0.18)' : isRecording ? 'rgba(200,131,42,0.15)' : 'transparent',
                  border: isConflict ? '1px solid #c0392b' : '1px solid transparent',
                }}
              >
                <span style={{ color: '#ccc', fontSize: 13 }}>{a.description}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Button
                    size="small"
                    onClick={() => { setConflictId(null); setRecordingId(isRecording ? null : a.id) }}
                    style={{
                      minWidth: 90, fontFamily: 'monospace',
                      background: isRecording ? 'var(--accent)' : '#1e1e1e',
                      borderColor: isConflict ? '#c0392b' : '#333',
                      color: isRecording ? '#000' : b ? '#ddd' : '#666',
                    }}
                  >
                    {isRecording ? '按下组合键…' : b ? formatBinding(b) : '无'}
                  </Button>
                  {b && (
                    <Button size="small" type="text" icon={<CloseOutlined />} title="清除绑定" onClick={() => clearBinding(a.id)} style={{ color: '#888' }} />
                  )}
                  {!isDefault && b && (
                    <Tag color="orange" style={{ margin: 0, fontSize: 10 }}>已改</Tag>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
