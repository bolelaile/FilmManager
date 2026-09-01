/**
 * 快捷键帮助浮层（? 触发）。只读展示当前绑定，按类别分组。
 */
import { Modal } from 'antd'
import { useUIStore } from '../../store'
import { useShortcutsStore } from '../../store/shortcutsSlice'
import { SHORTCUT_ACTIONS } from '../../shortcuts/registry'
import { formatBinding } from '../../shortcuts/accelerator'

const CATEGORY_LABEL: Record<string, string> = {
  '全局': '全局',
  '照片网格': '照片网格（照片视图）',
  '全屏预览': '全屏预览',
}

export default function ShortcutsHelp() {
  const open = useUIStore((s) => s.shortcutsHelpOpen)
  const setOpen = useUIStore((s) => s.setShortcutsHelpOpen)
  const bindings = useShortcutsStore((s) => s.bindings)

  const grouped = SHORTCUT_ACTIONS.reduce<Record<string, typeof SHORTCUT_ACTIONS>>((acc, a) => {
    (acc[a.category] ??= []).push(a)
    return acc
  }, {})

  return (
    <Modal
      title="快捷键"
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      width={560}
    >
      {Object.entries(grouped).map(([cat, actions]) => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--accent)' }}>{CATEGORY_LABEL[cat] ?? cat}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px', fontSize: 13 }}>
            {actions.map((a) => (
              <Row key={a.id} desc={a.description} binding={bindings[a.id] ?? ''} />
            ))}
          </div>
        </div>
      ))}
    </Modal>
  )
}

function Row({ desc, binding }: { desc: string; binding: string }) {
  return (
    <>
      <span style={{ color: 'var(--text-secondary)' }}>{desc}</span>
      <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)', textAlign: 'right' }}>
        {binding ? formatBinding(binding) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
      </span>
    </>
  )
}
