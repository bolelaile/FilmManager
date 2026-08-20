import React, { useEffect } from 'react'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import Library from './pages/Library'
import { useUIStore, THEMES, applyTheme } from './store/uiSlice'
import 'antd/dist/reset.css'

// 声明全局 API 类型
declare global {
  interface Window {
    api: import('../../preload/index').FilmManagerAPI
  }
}

export default function App() {
  const { appTheme } = useUIStore()
  const cfg = THEMES.find((t) => t.id === appTheme) ?? THEMES[0]

  // Apply CSS variables on mount and theme change
  useEffect(() => { applyTheme(cfg) }, [cfg])

  const antTheme = {
    algorithm: theme.darkAlgorithm,
    token: {
      colorPrimary: cfg.accent,
      colorBgBase: cfg.bgBase,
      colorBgContainer: cfg.bgElevated,
      colorBgElevated: cfg.bgElevated,
      colorBorder: cfg.border,
      colorBorderSecondary: cfg.border,
      borderRadius: 6,
      fontFamily: '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
      colorTextBase: cfg.textPrimary,
      colorTextSecondary: cfg.textSecondary,
      colorTextDisabled: cfg.textDim,
      colorSuccess: '#52c41a',
      colorWarning: '#faad14',
      colorError: '#ff4d4f'
    },
    components: {
      Layout: {
        bodyBg: cfg.bgBase,
        headerBg: cfg.bgHeader,
        siderBg: cfg.bgSurface
      },
      Tree: {
        colorBgContainer: 'transparent',
        directoryNodeSelectedBg: cfg.bgElevated,
        nodeSelectedBg: cfg.accentDim
      },
      Select: {
        colorBgContainer: cfg.bgSurface,
        colorBorder: cfg.borderStrong,
        optionSelectedBg: cfg.accentDim
      },
      Input: {
        colorBgContainer: cfg.bgSurface,
        colorBorder: cfg.borderStrong,
        activeBorderColor: cfg.accent
      },
      Drawer: {
        colorBgElevated: cfg.bgSurface
      },
      Modal: {
        contentBg: cfg.bgSurface,
        headerBg: cfg.bgSurface
      },
      Collapse: {
        headerBg: 'transparent',
        contentBg: 'transparent',
        colorBorder: cfg.border
      }
    }
  }

  return (
    <ConfigProvider locale={zhCN} theme={antTheme}>
      <Library />
    </ConfigProvider>
  )
}

