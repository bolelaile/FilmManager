// 显式 import 而非重导出语法，确保在本模块体内有局部绑定可用
import { useFilterStore } from './filterSlice'
import { useLibraryStore } from './librarySlice'
import { useUIStore } from './uiSlice'
import { useShortcutsStore } from './shortcutsSlice'

export { useFilterStore, useLibraryStore, useUIStore, useShortcutsStore }
export type { AppTheme, ThemeConfig } from './uiSlice'
export { THEMES, applyTheme } from './uiSlice'

/**
 * 向后兼容的组合 hook：现有所有使用 useStore() 的组件无需改动。
 * 新代码可直接按需订阅单个 store（useFilterStore / useLibraryStore / useUIStore / useShortcutsStore），
 * 以减少无关重渲染。
 */
export const useStore = () => ({
  ...useFilterStore(),
  ...useLibraryStore(),
  ...useUIStore(),
  ...useShortcutsStore()
})

// 允许直接读取 store 状态（不订阅）——兼容现有 useStore.getState() 调用
useStore.getState = () => ({
  ...useFilterStore.getState(),
  ...useLibraryStore.getState(),
  ...useUIStore.getState(),
  ...useShortcutsStore.getState()
})
