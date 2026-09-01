/**
 * 统计仪表盘弹窗。
 * 调 stats:dashboard 获取全库统计，用纯 CSS 柱状图展示（不引入图表库）。
 */
import { useEffect, useState } from 'react'
import { Modal, Spin, Empty } from 'antd'

interface DashboardData {
  total: number
  librarySize: number
  rollCount: number
  locationCount: number
  byMonth: { month: string; count: number }[]
  byFilm: { value: string; icon_key?: string | null; count: number }[]
  byCamera: { value: string; count: number }[]
  byLens: { value: string; count: number }[]
  byLocation: { name: string; count: number }[]
  byRoll: { name: string; count: number }[]
}

interface Props {
  open: boolean
  onClose: () => void
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 50px', gap: 8, alignItems: 'center', marginBottom: 4 }}>
      <span style={{ fontSize: 12, color: '#bbb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={label}>{label}</span>
      <div style={{ height: 14, background: '#222', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width .3s' }} />
      </div>
      <span style={{ fontSize: 12, color: '#888', textAlign: 'right' }}>{count}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

export default function StatsModal({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    window.api.stats.dashboard()
      .then((d) => setData(d as DashboardData))
      .finally(() => setLoading(false))
  }, [open])

  const maxMonth = Math.max(1, ...(data?.byMonth ?? []).map((m) => m.count))
  const maxFilm = Math.max(1, ...(data?.byFilm ?? []).map((m) => m.count))
  const maxCamera = Math.max(1, ...(data?.byCamera ?? []).map((m) => m.count))
  const maxLens = Math.max(1, ...(data?.byLens ?? []).map((m) => m.count))
  const maxLoc = Math.max(1, ...(data?.byLocation ?? []).map((m) => m.count))

  return (
    <Modal title="统计仪表盘" open={open} onCancel={onClose} width={1000} footer={null}>
      <Spin spinning={loading}>
        {!data && !loading ? <Empty /> : data && (
          <>
            {/* 数字卡 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              <StatCard label="照片总数" value={String(data.total)} />
              <StatCard label="库容量" value={fmtSize(data.librarySize)} />
              <StatCard label="胶卷数" value={String(data.rollCount)} />
              <StatCard label="地点数" value={String(data.locationCount)} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <Section title="按月拍摄趋势（近 24 月）">
                {data.byMonth.length === 0
                  ? <div style={{ color: '#555', fontSize: 12 }}>暂无数据</div>
                  : data.byMonth.map((m) => <BarRow key={m.month} label={m.month} count={m.count} max={maxMonth} />)}
              </Section>
              <Section title="按胶片（Top 20）">
                {data.byFilm.length === 0
                  ? <div style={{ color: '#555', fontSize: 12 }}>暂无数据</div>
                  : data.byFilm.map((m) => <BarRow key={m.value} label={m.value} count={m.count} max={maxFilm} />)}
              </Section>
              <Section title="按相机（Top 20）">
                {data.byCamera.length === 0
                  ? <div style={{ color: '#555', fontSize: 12 }}>暂无数据</div>
                  : data.byCamera.map((m) => <BarRow key={m.value} label={m.value} count={m.count} max={maxCamera} />)}
              </Section>
              <Section title="按镜头（Top 20）">
                {data.byLens.length === 0
                  ? <div style={{ color: '#555', fontSize: 12 }}>暂无数据</div>
                  : data.byLens.map((m) => <BarRow key={m.value} label={m.value} count={m.count} max={maxLens} />)}
              </Section>
              <Section title="按地点（Top 20）">
                {data.byLocation.length === 0
                  ? <div style={{ color: '#555', fontSize: 12 }}>暂无数据</div>
                  : data.byLocation.map((m) => <BarRow key={m.name} label={m.name} count={m.count} max={maxLoc} />)}
              </Section>
              <Section title="按卷（Top 20）">
                {data.byRoll.length === 0
                  ? <div style={{ color: '#555', fontSize: 12 }}>暂无数据</div>
                  : data.byRoll.map((m) => <BarRow key={m.name} label={m.name} count={m.count} max={Math.max(1, ...data.byRoll.map((r) => r.count))} />)}
              </Section>
            </div>
          </>
        )}
      </Spin>
    </Modal>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ color: 'var(--accent)', fontSize: 22, fontWeight: 600 }}>{value}</div>
    </div>
  )
}
