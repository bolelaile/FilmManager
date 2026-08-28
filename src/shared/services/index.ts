/**
 * 服务接口契约（跨进程共享）。
 * 定义各功能核心的 Service 接口，主进程实现、IPC 适配层转发、渲染层经 service-client 调用。
 * 本文件仅定义接口（不含实现），确保层间契约清晰、可单独替换/升级。
 *
 * 重构渐进式：批次 0 先建骨架与 Photo 接口示例，后续批次补全其余接口。
 */

export { type IPhotoService } from './photo-service'
