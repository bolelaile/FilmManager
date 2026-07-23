import React from 'react'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import Library from './pages/Library'
import 'antd/dist/reset.css'

// 声明全局 API 类型
declare global {
  interface Window {
    api: import('../../preload/index').FilmManagerAPI
  }
}

const filmTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#c8832a',
    colorBgBase: '#141414',
    colorBgContainer: '#1f1f1f',
    colorBgElevated: '#2a2a2a',
    colorBorder: '#2a2a2a',
    colorBorderSecondary: '#222',
    borderRadius: 6,
    fontFamily: '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
    colorTextBase: '#e0e0e0',
    colorTextSecondary: '#888',
    colorTextDisabled: '#444',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f'
  },
  components: {
    Layout: {
      bodyBg: '#141414',
      headerBg: '#1a1a1a',
      siderBg: '#181818'
    },
    Tree: {
      colorBgContainer: 'transparent',
      directoryNodeSelectedBg: '#2a2a2a',
      nodeSelectedBg: '#2a1a08'
    },
    Select: {
      colorBgContainer: '#222',
      colorBorder: '#333',
      optionSelectedBg: '#2a1a08'
    },
    Input: {
      colorBgContainer: '#222',
      colorBorder: '#333',
      activeBorderColor: '#c8832a'
    },
    Drawer: {
      colorBgElevated: '#181818'
    },
    Modal: {
      contentBg: '#1a1a1a',
      headerBg: '#1a1a1a'
    },
    Collapse: {
      headerBg: 'transparent',
      contentBg: 'transparent',
      colorBorder: '#252525'
    }
  }
}

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={filmTheme}>
      <Library />
    </ConfigProvider>
  )
}
