import { Worker } from 'worker_threads'
import path from 'path'
import log from 'electron-log'

interface PendingTask {
  resolve: (thumbPath: string | null) => void
  reject: (err: Error) => void
}

interface PendingEntry {
  pending: PendingTask
  workerId: number
}

interface WorkerState {
  worker: Worker
  workerId: number
  busy: boolean
  // 该 worker 当前在途任务 id（池模式下同时只有 1 个）
  taskIds: Set<number>
}

let workerScriptPath: string | null = null

function getWorkerScript(): string {
  if (workerScriptPath) return workerScriptPath
  // In production (asar): out/main/workers/thumbnail-worker.js
  // In dev: out/main/workers/thumbnail-worker.js (electron-vite writes here)
  workerScriptPath = path.join(__dirname, 'workers', 'thumbnail-worker.js')
  return workerScriptPath
}

class ThumbnailWorkerPool {
  private readonly size: number
  private workers: WorkerState[] = []
  private queue: Array<{ task: { id: number; sourcePath: string; thumbDir: string; rotation?: number }; pending: PendingTask }> = []
  private pending: Map<number, PendingEntry> = new Map()
  private nextId = 1
  private nextWorkerId = 1
  private started = false
  // 标记主动 terminate，防止 exit 回调误判为崩溃而重建
  private terminating = false

  constructor(size = 4) {
    this.size = size
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.terminating = false
    for (let i = 0; i < this.size; i++) {
      this.spawnWorker()
    }
  }

  private spawnWorker(): void {
    let w: Worker
    try {
      w = new Worker(getWorkerScript())
    } catch (err) {
      log.warn('ThumbnailWorkerPool: failed to spawn worker, falling back to inline', err)
      return
    }
    const state: WorkerState = { worker: w, workerId: this.nextWorkerId++, busy: false, taskIds: new Set() }
    this.workers.push(state)

    w.on('message', (msg: { id: number; thumbPath: string | null; error: string | null }) => {
      const entry = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      state.taskIds.delete(msg.id)
      state.busy = false
      if (entry) {
        if (msg.error) entry.pending.reject(new Error(msg.error))
        else entry.pending.resolve(msg.thumbPath)
      }
      this.drain()
    })

    w.on('error', (err) => {
      log.error('ThumbnailWorkerPool: worker error', err)
      this.reclaimWorker(state, `worker error: ${err.message}`)
    })

    // worker 线程异常退出（非主动 terminate）时回收在途任务并重建
    w.on('exit', (code) => {
      if (this.terminating) return
      log.warn('ThumbnailWorkerPool: worker exited unexpectedly, code=', code)
      this.reclaimWorker(state, `worker exited (code=${code})`)
    })
  }

  /**
   * 回收一个已失效的 worker：reject 其全部在途任务，从池中移除，
   * 并在池仍运行时重建一个 worker 以维持池大小。
   * 幂等：worker 的 'error' 与 'exit' 会相继触发，第二次调用直接返回，避免重复重建。
   */
  private reclaimWorker(state: WorkerState, reason: string): void {
    // 若已从池中移除，说明已被另一事件回收过，直接返回避免重复 spawn
    const idx = this.workers.indexOf(state)
    if (idx === -1) return
    this.workers.splice(idx, 1)

    // reject 该 worker 上所有在途任务
    for (const taskId of state.taskIds) {
      const entry = this.pending.get(taskId)
      this.pending.delete(taskId)
      if (entry) {
        entry.pending.reject(new Error(reason))
      }
    }
    state.taskIds.clear()
    state.busy = false

    try { state.worker.terminate() } catch {}

    // 池仍在运行则重建以恢复吞吐
    if (this.started && !this.terminating) {
      this.spawnWorker()
      // 重建后尝试排空积压队列
      this.drain()
    }
  }

  private drain(): void {
    if (this.queue.length === 0) return
    const idle = this.workers.find((w) => !w.busy)
    if (!idle) return
    const next = this.queue.shift()!
    idle.busy = true
    idle.taskIds.add(next.task.id)
    this.pending.set(next.task.id, { pending: next.pending, workerId: idle.workerId })
    idle.worker.postMessage(next.task)
    // Recurse to fill all idle workers
    this.drain()
  }

  generate(sourcePath: string, thumbDir: string, rotation = 0): Promise<string | null> {
    if (!this.started || this.workers.length === 0) {
      // Pool unavailable — caller should fallback to inline generation
      return Promise.resolve(null)
    }
    return new Promise<string | null>((resolve, reject) => {
      const id = this.nextId++
      const task = { id, sourcePath, thumbDir, rotation }
      const pending: PendingTask = { resolve, reject }
      const idle = this.workers.find((w) => !w.busy)
      if (idle) {
        idle.busy = true
        idle.taskIds.add(id)
        this.pending.set(id, { pending, workerId: idle.workerId })
        idle.worker.postMessage(task)
      } else {
        this.queue.push({ task, pending })
      }
    })
  }

  async terminate(): Promise<void> {
    this.started = false
    this.terminating = true
    for (const { worker } of this.workers) {
      await worker.terminate()
    }
    this.workers = []
    this.terminating = false
  }
}

export const thumbnailPool = new ThumbnailWorkerPool(4)
