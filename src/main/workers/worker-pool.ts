import { Worker } from 'worker_threads'
import path from 'path'
import log from 'electron-log'

interface PendingTask {
  resolve: (thumbPath: string | null) => void
  reject: (err: Error) => void
}

interface WorkerState {
  worker: Worker
  busy: boolean
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
  private pending: Map<number, PendingTask> = new Map()
  private nextId = 1
  private started = false

  constructor(size = 4) {
    this.size = size
  }

  start(): void {
    if (this.started) return
    this.started = true
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
    const state: WorkerState = { worker: w, busy: false }
    this.workers.push(state)

    w.on('message', (msg: { id: number; thumbPath: string | null; error: string | null }) => {
      const p = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      state.busy = false
      if (p) {
        if (msg.error) p.reject(new Error(msg.error))
        else p.resolve(msg.thumbPath)
      }
      this.drain()
    })

    w.on('error', (err) => {
      log.error('ThumbnailWorkerPool: worker error', err)
      // Requeue all pending tasks assigned to this worker — can't identify which,
      // so just mark worker as no longer busy and let drain pick up queued tasks.
      state.busy = false
      this.drain()
    })
  }

  private drain(): void {
    if (this.queue.length === 0) return
    const idle = this.workers.find((w) => !w.busy)
    if (!idle) return
    const next = this.queue.shift()!
    idle.busy = true
    this.pending.set(next.task.id, next.pending)
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
        this.pending.set(id, pending)
        idle.worker.postMessage(task)
      } else {
        this.queue.push({ task, pending })
      }
    })
  }

  async terminate(): Promise<void> {
    for (const { worker } of this.workers) {
      await worker.terminate()
    }
    this.workers = []
    this.started = false
  }
}

export const thumbnailPool = new ThumbnailWorkerPool(4)
