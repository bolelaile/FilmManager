import React, { useState, useEffect } from 'react'
import {
  Modal, Tabs, Button, Input, List, Switch, Popconfirm,
  Space, Tag, message, Divider, Empty, Tooltip, Spin
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  CheckOutlined, CloseOutlined, LockOutlined, ImportOutlined, PictureOutlined,
  FolderOpenOutlined, GithubOutlined, FileTextOutlined, ReloadOutlined
} from '@ant-design/icons'
import type { AttributeType, AttributeValue, IccProfile } from '../../types'
import { useStore } from '../../store'
import { FilmIconImg } from '../FilmIcon'

const CHANGELOG: { version: string; summary: string; items: string[] }[] = [
  {
    version: '1.3.4',
    summary: 'UI 规范化、卷视图大缩略图重设计与性能/功能增强',
    items: [
      '卷视图大缩略图改为横向详情行布局——行高固定 220px，左侧 55% 封面图，右侧 45% 展示卷名、胶片/格式、相机/镜头、地点、拍摄年月及操作按钮',
      '统一所有弹窗的 borderRadius=8、footer padding 及 body padding，消除按钮/输入框贴合窗口边框的问题',
      '设置—关于页面新增版本更新历史面板（可滚动，由新到旧列出各版本摘要与详细变更）',
      '缩略图 Worker Pool——主进程启动 4 线程并行生成缩略图，批量导入速度大幅提升',
      '收藏/星标系统——卡片右下角星标按钮、全屏预览标题栏切换按钮、筛选面板"已收藏"条目，支持批量收藏',
      'EXIF GPS 自动地点关联——导入时读取 GPS 坐标，100 米内匹配已有地点或自动创建新地点',
    ],
  },
  {
    version: '1.3.3',
    summary: '相机画幅属性与格式识别增强 + 导入与卷管理优化',
    items: [
      '新增 camera_formats（支持画幅列表）和 camera_default_format（默认画幅）字段',
      '新增 6x9 中画幅 和 135 宽幅/Xpan 两种胶片格式预设值',
      '新增 70+ 款相机预设（Pentax、Contax、Mamiya、Bronica、Fuji GW/TX、Hasselblad Xpan、Rolleiflex、海鸥、Holga/Diana 等）',
      '导入时相机单一画幅直接写入，多画幅与 film_size_type 取交集再调用像素分析',
      '文件夹名称解析支持复合命名字段提取，并通过地点数据库模糊匹配自动填入拍摄地点',
      '卷模式导入新增"单文件夹为一卷"选项及存储方式选择（复制/索引）',
      'RollsView 新增多选框架、批量属性修改和批量删除，删除卷支持三档选项',
      '卷视图独立三档缩略图尺寸，顶栏控件在卷视图与照片视图间独立切换',
      '卷视图支持框选多选与右键多选（Ctrl/Meta/Shift 点击）',
    ],
  },
  {
    version: '1.3.2',
    summary: '格式识别优化与胶卷分类',
    items: [
      '修复 6×6 中画幅被误判为半格——比例检测优先于齿孔检测',
      '新增 film_size_type 胶卷属性字段，按 135/120/both 分类，导入时约束格式识别范围',
      '统一所有 fuji 开头胶卷名称为 Fuji，并添加模糊匹配别名',
      '新增乐凯 Lucky c400 预设（135/120 通用）',
    ],
  },
  {
    version: '1.3.1+',
    summary: '胶片格式自动识别与卷导入增强',
    items: [
      '导入时通过 Sharp 像素采样自动识别胶片格式（135/半格/645/6×6/6×7/6×12 等），不覆盖已手动标注的格式',
      '新增半格/645/6×6/6×7/6×8/6×12 共 6 种胶片格式预设值',
      '子文件夹卷确认表格所有属性 Select 支持内联新增值',
      '卷导入模式新增拖放根目录区域',
    ],
  },
  {
    version: '1.3.1',
    summary: '两阶段导入、存储模式与 Bug 修复',
    items: [
      '两阶段导入——第一阶段批量登记占位记录，图库立即呈现骨架卡片；第二阶段后台逐张完成 EXIF 解析、拷贝与缩略图生成',
      '导入对话框新增"复制到图库/建立索引"两种存储模式',
      '全局后台导入进度条，完成后 2 秒自动消失',
      '新增 import_queue 任务队列表',
      '修复 linked 模式下误删原始文件及移动子库行为',
    ],
  },
  {
    version: '1.3.0',
    summary: '架构重构与稳定性加固',
    items: [
      'Zustand Store 按领域拆分为三个独立 slice，保留 useStore() 向后兼容导出',
      'Library.tsx 拆分为三个自定义 hook（usePhotoLoader / useRollLoader / useLibraryData）',
      '提取 src/shared/import-types.ts 消除 preload 与 main 进程重复类型定义',
      '新增基于内容哈希的重复文件检测（MD5 文件大小 + 前 64KB），重复文件自动跳过',
      '数据库新增 content_hash 列及索引、original_name 搜索索引',
      'COUNT 查询以 COUNT(DISTINCT p.id) 替代子查询包裹，消除 ORDER BY 双重开销',
      'photos:delete 与 photos:setAttributes 操作原子化，任一步骤失败整体回滚',
    ],
  },
  {
    version: '1.2.1',
    summary: '地图方案切换',
    items: [
      '地图视图回归 Leaflet，采用三源自动轮换（OSM.de → Esri → OSM），连续 2 次错误或 25s 无响应后自动切换',
      '瓦片加载状态实时显示，失败时提供一键重试',
      'LocationPicker 恢复为检索 + 手动坐标录入模式',
    ],
  },
  {
    version: '1.2.0',
    summary: '版本整合与全面优化',
    items: [
      '地图视图改用 MapLibre GL JS（WebGL canvas 渲染，彻底修复 Modal 内黑屏），实现三源自动轮换',
      'BatchEditModal 新增批量设置拍摄地点功能（set/skip/clear 三档）',
      '地点种子数据大幅扩充（各省地级市、旅行摄影常用地点，修正错别字）',
      'setForPhotos IPC 支持 locationId=null 直接清除地点',
    ],
  },
  {
    version: '1.1.12',
    summary: '稳定性修复',
    items: [
      '修复筛选条件切换时照片网格空白的 race condition——改用单调递增 loadCounterRef',
      '新增用户操作安全刷新机制，停止操作 800ms 后自动硬刷新',
      '修复地点地图 Modal 动画期间黑屏——通过 afterOpenChange 与兜底定时器双重触发 invalidateSize()',
    ],
  },
  {
    version: '1.1.11',
    summary: '外部软件联动',
    items: [
      '全屏预览标题栏新增"用其他应用打开"按钮，照片网格右键菜单新增同名条目，支持多选批量传入',
      '自动检测本机已安装的图像处理软件（Photoshop、Lightroom、GIMP、Capture One、RawTherapee、darktable、IrfanView、FastStone、XnViewMP、ACDSee、Affinity Photo、像素蛋糕、Luminar Neo 等）',
    ],
  },
  {
    version: '1.1.10',
    summary: '地点功能完善',
    items: [
      '地点地图默认显示以中国为主视图的世界地图，有已导入地点时自动 fitBounds',
      '地图钉点击后侧栏展示该地点照片缩略图及拍摄日期',
      '地点选择器新增地图选点模式（点击/拖拽标记自动反向地理编码）',
      '全屏预览侧栏底部新增"拍摄地点"编辑区',
      '卷视图卡片新增地点按钮，可批量为该卷所有照片设置或清除地点',
    ],
  },
  {
    version: '1.1.9',
    summary: '筛选联动计数 · BMP 修复 · 大视图悬停预览',
    items: [
      '左侧筛选面板联动计数：有筛选条件时只显示结果集中存在的属性值（faceted search）',
      'BMP 预览与缩略图修复，改用纯 JS BMP 解码器，库中已有缺失缩略图在打开时自动重新生成',
      '新增 234 种胶卷预设图标（ADOX、AGFA、Cinestill、Fuji 全系、Rollei 全系等）',
      '大视图右侧新增固定宽度悬停预览面板（即时缩略图 + 280ms 防抖全分辨率预览 + 详细元数据）',
    ],
  },
  {
    version: '1.1.8',
    summary: '本地树状目录同步',
    items: [
      '子库映射为 {libraryRoot}/files/ 下的真实目录树，导入、移动、重命名、删除子库均同步本地文件',
      '首次启动自动把旧版扁平 files/ 目录迁移为真实目录树，迁移可重复执行',
      '文件或目录重名时自动追加数字后缀，Windows 非法字符替换为 _',
    ],
  },
  {
    version: '1.1.7',
    summary: 'leaf v1.1.3 与 v1.1.x 功能合并',
    items: [
      '胶卷视图与建卷、未分卷汇总（"其他图片"入口）',
      '子文件夹批量导入——扫描确认表，可逐行调整卷名、属性、日期后统一导入',
      '智能文件夹名称解析（父子目录属性推断、复合名称、模糊匹配）',
      '胶片/相机/镜头支持多别名，属性库支持 JSON 批量导入',
    ],
  },
  {
    version: '1.1.3',
    summary: '整理、EXIF 识别与操作增强',
    items: [
      '导入时可按年份、年月、相机、胶片或来源文件夹自动整理到子库',
      'EXIF 相机/镜头识别，可手动覆盖并控制是否自动收录新器材',
      '整理状态筛选（未分类/缺拍摄日期/缺相机信息）',
      '90° 旋转持久化（缩略图与完整预览同步重建）',
      '单张/多张跨子库移动，任意层级子库右键删除',
    ],
  },
  {
    version: '1.1.0',
    summary: 'EXIF 自动读取与批量编辑',
    items: [
      'EXIF 自动读取（拍摄日期、相机与镜头型号）',
      '子库照片数统计（含全部后代）',
      '批量属性编辑',
      '相机库/镜头库独立管理',
    ],
  },
  {
    version: '1.0.3',
    summary: 'Modal 查看器与属性管理',
    items: [
      'Modal 全屏查看器',
      '中文属性 search-to-create',
      '查看器属性编辑侧栏',
      '胶卷库管理',
    ],
  },
  {
    version: '1.0.2',
    summary: '缩略图与交互优化',
    items: [
      '缩略图优化、拖拽导入',
      'RGB 直方图、缩放平移',
      '框选、右键菜单',
    ],
  },
  {
    version: '1.0.0',
    summary: '初始版本',
    items: [
      '照片导入、属性标注、子库管理',
      '全屏预览',
    ],
  },
]

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  onAttrChange: () => void
}

export default function SettingsModal({ open, onClose, onAttrChange }: SettingsModalProps) {
  const [attrTypes, setAttrTypes] = useState<AttributeType[]>([])
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null)
  const [attrValues, setAttrValues] = useState<AttributeValue[]>([])
  const [newTypeName, setNewTypeName] = useState('')
  const [newValueName, setNewValueName] = useState('')
  const [editingTypeId, setEditingTypeId] = useState<number | null>(null)
  const [editingTypeName, setEditingTypeName] = useState('')
  const [editingValueId, setEditingValueId] = useState<number | null>(null)
  const [editingValueName, setEditingValueName] = useState('')
  const [profiles, setProfiles] = useState<IccProfile[]>([])
  const { setIccProfiles, mergeFilmIconCache } = useStore()

  // storage tab
  const [libraryRoot, setLibraryRoot] = useState('')
  const [savingRoot, setSavingRoot] = useState(false)

  // about tab
  const [appVersion, setAppVersion] = useState('')

  // log tab
  const [logContent, setLogContent] = useState('')
  const [logPath, setLogPath] = useState('')
  const [logLoading, setLogLoading] = useState(false)

  const load = async () => {
    const types = await window.api.attrs.listTypes() as AttributeType[]
    setAttrTypes(types)
    if (selectedTypeId) {
      const vals = await window.api.attrs.listValues(selectedTypeId) as AttributeValue[]
      setAttrValues(vals)
    }
  }

  const loadProfiles = async () => {
    const p = await window.api.library.listProfiles() as IccProfile[]
    setProfiles(p)
    setIccProfiles(p)
  }

  const loadStorageInfo = async () => {
    const root = await window.api.app.getLibraryRoot() as string
    setLibraryRoot(root)
  }

  const loadAboutInfo = async () => {
    const ver = await window.api.app.getVersion() as string
    setAppVersion(ver)
  }

  const loadLog = async () => {
    setLogLoading(true)
    try {
      const [content, p] = await Promise.all([
        window.api.app.getLogContent(300) as Promise<string>,
        window.api.app.getLogPath() as Promise<string>
      ])
      setLogContent(content)
      setLogPath(p)
    } finally {
      setLogLoading(false)
    }
  }

  useEffect(() => {
    if (open) { load(); loadProfiles(); loadStorageInfo(); loadAboutInfo() }
  }, [open])

  useEffect(() => {
    if (selectedTypeId) {
      window.api.attrs.listValues(selectedTypeId).then((v) => setAttrValues(v as AttributeValue[]))
    }
  }, [selectedTypeId])

  const handleAddType = async () => {
    if (!newTypeName.trim()) return
    await window.api.attrs.addType(newTypeName.trim())
    setNewTypeName('')
    load()
    onAttrChange()
  }

  const handleRenameType = async (id: number) => {
    await window.api.attrs.updateType(id, editingTypeName)
    setEditingTypeId(null)
    load()
    onAttrChange()
  }

  const handleToggleType = async (id: number, active: boolean) => {
    await window.api.attrs.toggleType(id, active)
    load()
    onAttrChange()
  }

  const handleDeleteType = async (id: number) => {
    await window.api.attrs.deleteType(id)
    if (selectedTypeId === id) setSelectedTypeId(null)
    load()
    onAttrChange()
  }

  const handleAddValue = async () => {
    if (!newValueName.trim() || !selectedTypeId) return
    await window.api.attrs.addValue(selectedTypeId, newValueName.trim())
    setNewValueName('')
    const vals = await window.api.attrs.listValues(selectedTypeId) as AttributeValue[]
    setAttrValues(vals)
    onAttrChange()
  }

  const handleRenameValue = async (id: number) => {
    await window.api.attrs.updateValue(id, editingValueName)
    setEditingValueId(null)
    const vals = await window.api.attrs.listValues(selectedTypeId!) as AttributeValue[]
    setAttrValues(vals)
    onAttrChange()
  }

  const handleDeleteValue = async (id: number) => {
    await window.api.attrs.deleteValue(id)
    const vals = await window.api.attrs.listValues(selectedTypeId!) as AttributeValue[]
    setAttrValues(vals)
    onAttrChange()
  }

  const handleChangeIcon = async (value: AttributeValue) => {
    const key = await window.api.attrs.importCustomIcon() as string | null
    if (!key) return
    await window.api.attrs.updateValue(value.id, value.value, key)
    // refresh icon cache
    const url = await window.api.attrs.filmIconDataUrl(key, 64) as string | null
    if (url) mergeFilmIconCache({ [key]: url })
    const vals = await window.api.attrs.listValues(selectedTypeId!) as AttributeValue[]
    setAttrValues(vals)
    onAttrChange()
  }

  const handleImportProfile = async () => {
    const imported = await window.api.library.importProfile() as string[]
    if (imported.length > 0) {
      message.success(`已导入 ${imported.length} 个配置文件`)
      loadProfiles()
    }
  }

  const handlePickLibraryRoot = async () => {
    const picked = await window.api.app.pickLibraryRoot() as string | null
    if (picked) setLibraryRoot(picked)
  }

  const handleSaveLibraryRoot = async () => {
    if (!libraryRoot.trim()) return
    setSavingRoot(true)
    try {
      await window.api.app.setLibraryRoot(libraryRoot.trim())
      message.success('存储路径已保存，重启应用后生效')
    } finally {
      setSavingRoot(false)
    }
  }

  const selectedType = attrTypes.find((t) => t.id === selectedTypeId)
  const isFilmType = selectedType?.key === 'film'

  return (
    <Modal
      title="设置"
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      mask={false}
      styles={{
        content: { background: '#1a1a1a', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)', borderRadius: 8 },
        header: { background: '#1a1a1a', borderBottom: '1px solid #252525', borderRadius: '8px 8px 0 0' }
      }}
    >
      <Tabs
        defaultActiveKey="attrs"
        items={[
          {
            key: 'attrs',
            label: '属性管理',
            children: (
              <div style={{ display: 'flex', gap: 16, height: 460 }}>
                {/* 属性类型列表 */}
                <div style={{ width: 220, borderRight: '1px solid #252525', paddingRight: 16 }}>
                  <div style={{ color: '#888', fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                    属性类别
                  </div>
                  <div style={{ overflowY: 'auto', maxHeight: 360 }}>
                    {attrTypes.map((type) => (
                      <div
                        key={type.id}
                        onClick={() => setSelectedTypeId(type.id)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 4,
                          cursor: 'pointer',
                          background: selectedTypeId === type.id ? '#2a2a2a' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 2
                        }}
                      >
                        {editingTypeId === type.id ? (
                          <Input
                            size="small"
                            value={editingTypeName}
                            onChange={(e) => setEditingTypeName(e.target.value)}
                            onPressEnter={() => handleRenameType(type.id)}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                            style={{ flex: 1, marginRight: 4 }}
                          />
                        ) : (
                          <span style={{ color: type.is_active ? '#ccc' : '#555', flex: 1, fontSize: 13 }}>
                            {type.display_name}
                            {type.is_system ? (
                              <LockOutlined style={{ marginLeft: 4, fontSize: 10, color: '#555' }} />
                            ) : null}
                          </span>
                        )}
                        <Space size={2} onClick={(e) => e.stopPropagation()}>
                          {!type.is_system && (
                            <>
                              <Switch
                                size="small"
                                checked={!!type.is_active}
                                onChange={(v) => handleToggleType(type.id, v)}
                              />
                              {editingTypeId === type.id ? (
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<CheckOutlined />}
                                  onClick={() => handleRenameType(type.id)}
                                />
                              ) : (
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<EditOutlined />}
                                  onClick={() => { setEditingTypeId(type.id); setEditingTypeName(type.display_name) }}
                                />
                              )}
                              <Popconfirm
                                title="删除此属性类别？"
                                onConfirm={() => handleDeleteType(type.id)}
                                okText="删除"
                                cancelText="取消"
                              >
                                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </>
                          )}
                        </Space>
                      </div>
                    ))}
                  </div>
                  <Divider style={{ borderColor: '#252525', margin: '8px 0' }} />
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      size="small"
                      placeholder="新属性名称"
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      onPressEnter={handleAddType}
                    />
                    <Button size="small" icon={<PlusOutlined />} onClick={handleAddType} style={{ background: '#c8832a', borderColor: '#c8832a', color: '#fff' }} />
                  </Space.Compact>
                </div>

                {/* 属性值列表 */}
                <div style={{ flex: 1 }}>
                  {selectedType ? (
                    <>
                      <div style={{ color: '#888', fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                        {selectedType.display_name} 的可选值
                      </div>
                      <div style={{ overflowY: 'auto', maxHeight: 360 }}>
                        {attrValues.length === 0 && (
                          <Empty description={<span style={{ color: '#555' }}>暂无预设值</span>} />
                        )}
                        {attrValues.map((v) => (
                          <div
                            key={v.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '5px 0',
                              borderBottom: '1px solid #222'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                              {isFilmType && (
                                <Tooltip title={v.icon_key ? '更换图标' : '添加图标'}>
                                  <div
                                    onClick={() => handleChangeIcon(v)}
                                    style={{
                                      width: 28,
                                      height: 28,
                                      borderRadius: 4,
                                      background: '#1e1e1e',
                                      border: '1px dashed #333',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer',
                                      flexShrink: 0,
                                      overflow: 'hidden'
                                    }}
                                  >
                                    {v.icon_key ? (
                                      <FilmIconImg iconKey={v.icon_key} size={28} />
                                    ) : (
                                      <PictureOutlined style={{ color: '#444', fontSize: 12 }} />
                                    )}
                                  </div>
                                </Tooltip>
                              )}
                              {editingValueId === v.id ? (
                                <Input
                                  size="small"
                                  value={editingValueName}
                                  onChange={(e) => setEditingValueName(e.target.value)}
                                  onPressEnter={() => handleRenameValue(v.id)}
                                  autoFocus
                                  style={{ flex: 1, marginRight: 8 }}
                                />
                              ) : (
                                <span style={{ color: '#bbb', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {v.value}
                                  {v.is_preset ? (
                                    <Tag style={{ marginLeft: 6, fontSize: 9 }} color="default">预设</Tag>
                                  ) : null}
                                </span>
                              )}
                            </div>
                            <Space size={2}>
                              {editingValueId === v.id ? (
                                <Button size="small" type="text" icon={<CheckOutlined />} onClick={() => handleRenameValue(v.id)} />
                              ) : (
                                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => { setEditingValueId(v.id); setEditingValueName(v.value) }} />
                              )}
                              <Popconfirm title="删除此值？" onConfirm={() => handleDeleteValue(v.id)} okText="删除" cancelText="取消">
                                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </Space>
                          </div>
                        ))}
                      </div>
                      <Divider style={{ borderColor: '#252525', margin: '8px 0' }} />
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          size="small"
                          placeholder="新增选项..."
                          value={newValueName}
                          onChange={(e) => setNewValueName(e.target.value)}
                          onPressEnter={handleAddValue}
                        />
                        <Button size="small" icon={<PlusOutlined />} onClick={handleAddValue} style={{ background: '#c8832a', borderColor: '#c8832a', color: '#fff' }} />
                      </Space.Compact>
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', paddingTop: 80, color: '#555' }}>
                      从左侧选择一个属性类别
                    </div>
                  )}
                </div>
              </div>
            )
          },
          {
            key: 'profiles',
            label: '色彩配置文件',
            children: (
              <div>
                <div style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
                  用于 RAW 文件全屏预览时的色彩空间转换。预设配置文件已内置，可导入自定义 ICC/ICM 文件。
                </div>
                <Button
                  icon={<ImportOutlined />}
                  onClick={handleImportProfile}
                  style={{ marginBottom: 12, background: '#1e1e1e', borderColor: '#333', color: '#ccc' }}
                >
                  导入 ICC/ICM 文件
                </Button>
                <List
                  size="small"
                  dataSource={profiles}
                  renderItem={(p) => (
                    <List.Item>
                      <span style={{ color: '#ccc' }}>{p.name}</span>
                      {p.isPreset && <Tag>内置</Tag>}
                    </List.Item>
                  )}
                  style={{ background: '#1e1e1e', borderRadius: 6 }}
                />
              </div>
            )
          },
          {
            key: 'storage',
            label: '存储',
            children: (
              <div style={{ paddingTop: 8 }}>
                <div style={{ color: '#888', fontSize: 12, marginBottom: 16 }}>
                  图片文件与数据库存放位置。修改后需重启应用生效，<span style={{ color: '#c8832a' }}>原有文件不会自动迁移</span>，请手动复制。
                </div>
                <div style={{ color: '#aaa', fontSize: 12, marginBottom: 6 }}>当前存储目录</div>
                <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
                  <Input
                    value={libraryRoot}
                    onChange={(e) => setLibraryRoot(e.target.value)}
                    style={{ background: '#222', borderColor: '#333', color: '#ccc', flex: 1 }}
                    placeholder="存储目录路径..."
                  />
                  <Button
                    icon={<FolderOpenOutlined />}
                    onClick={handlePickLibraryRoot}
                    style={{ background: '#1e1e1e', borderColor: '#333', color: '#aaa' }}
                  >
                    浏览
                  </Button>
                  <Button
                    type="primary"
                    loading={savingRoot}
                    onClick={handleSaveLibraryRoot}
                    style={{ background: '#c8832a', borderColor: '#c8832a' }}
                  >
                    保存
                  </Button>
                </Space.Compact>
                <div style={{ background: '#111', borderRadius: 6, padding: '10px 14px', fontSize: 12 }}>
                  <div style={{ color: '#666', marginBottom: 4 }}>目录结构说明</div>
                  <div style={{ color: '#555', lineHeight: 1.8 }}>
                    <span style={{ color: '#888' }}>{libraryRoot || '<存储目录>'}/</span><br />
                    <span style={{ marginLeft: 16, color: '#666' }}>files/</span><span style={{ color: '#444', marginLeft: 8 }}>— 图片文件</span><br />
                    <span style={{ marginLeft: 16, color: '#666' }}>thumbs/</span><span style={{ color: '#444', marginLeft: 8 }}>— 缩略图缓存</span><br />
                    <span style={{ marginLeft: 16, color: '#666' }}>film.db</span><span style={{ color: '#444', marginLeft: 8 }}>— 数据库</span>
                  </div>
                </div>
              </div>
            )
          },
          {
            key: 'about',
            label: '关于',
            children: (
              <div style={{ paddingTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                  <div style={{ width: 64, height: 64, background: '#1e1e1e', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #2a2a2a', flexShrink: 0 }}>
                    <span style={{ fontSize: 32 }}>🎞</span>
                  </div>
                  <div>
                    <div style={{ color: '#e0e0e0', fontSize: 18, fontWeight: 600 }}>FilmManager</div>
                    <div style={{ color: '#666', fontSize: 12, marginTop: 3 }}>面向胶片摄影爱好者的本地管理工具</div>
                    <div style={{ color: '#c8832a', fontSize: 12, marginTop: 4 }}>v{appVersion}</div>
                  </div>
                </div>
                <Divider style={{ borderColor: '#252525', margin: '0 0 16px 0' }} />

                {/* 版本更新历史 */}
                <div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>更新历史</div>
                <div
                  style={{
                    maxHeight: 220,
                    overflowY: 'auto',
                    background: '#111',
                    border: '1px solid #252525',
                    borderRadius: 8,
                    padding: '4px 0',
                    marginBottom: 16,
                  }}
                >
                  {CHANGELOG.map((entry, i) => (
                    <div
                      key={entry.version}
                      style={{
                        padding: '10px 14px',
                        borderBottom: i < CHANGELOG.length - 1 ? '1px solid #1e1e1e' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 5 }}>
                        <span style={{
                          color: '#c8832a', fontSize: 12, fontWeight: 600,
                          fontFamily: 'Consolas, monospace', flexShrink: 0
                        }}>
                          v{entry.version}
                        </span>
                        <span style={{ color: '#aaa', fontSize: 12 }}>{entry.summary}</span>
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {entry.items.map((item, j) => (
                          <li key={j} style={{ color: '#666', fontSize: 11, lineHeight: 1.7 }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                  {[
                    { icon: <GithubOutlined style={{ fontSize: 18 }} />, label: 'GitHub 仓库', sub: 'bolelaile/FilmManager', url: 'https://github.com/bolelaile/FilmManager' },
                    { icon: <span style={{ fontSize: 18 }}>📦</span>, label: 'Releases', sub: '查看所有版本', url: 'https://github.com/bolelaile/FilmManager/releases' },
                    { icon: <span style={{ fontSize: 18 }}>🐛</span>, label: 'Issues', sub: '反馈问题', url: 'https://github.com/bolelaile/FilmManager/issues' },
                  ].map((item) => (
                    <div
                      key={item.url}
                      onClick={() => window.api.app.openExternal(item.url)}
                      style={{
                        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                        gap: 6, padding: '16px 12px', background: '#111',
                        border: '1px solid #252525', borderRadius: 10, cursor: 'pointer',
                        transition: 'border-color 0.15s, background 0.15s'
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#c8832a'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(200,131,42,0.06)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#252525'; (e.currentTarget as HTMLDivElement).style.background = '#111' }}
                    >
                      <span style={{ color: '#888' }}>{item.icon}</span>
                      <span style={{ color: '#ccc', fontSize: 12, fontWeight: 500 }}>{item.label}</span>
                      <span style={{ color: '#555', fontSize: 11 }}>{item.sub}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          },
          {
            key: 'log',
            label: '日志',
            children: (
              <div style={{ paddingTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: '#666', fontSize: 11 }}>{logPath || '...'}</span>
                  <Space size={6}>
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={logLoading}
                      onClick={loadLog}
                      style={{ background: '#1e1e1e', borderColor: '#333', color: '#aaa' }}
                    >
                      刷新
                    </Button>
                    <Button
                      size="small"
                      icon={<FolderOpenOutlined />}
                      onClick={() => window.api.app.revealLog()}
                      style={{ background: '#1e1e1e', borderColor: '#333', color: '#aaa' }}
                    >
                      打开目录
                    </Button>
                  </Space>
                </div>
                {logLoading ? (
                  <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                ) : (
                  <pre
                    style={{
                      background: '#0d0d0d',
                      border: '1px solid #222',
                      borderRadius: 6,
                      padding: '10px 12px',
                      fontSize: 11,
                      color: '#777',
                      fontFamily: 'Consolas, monospace',
                      maxHeight: 340,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      margin: 0,
                      lineHeight: 1.6
                    }}
                  >
                    {logContent || <span style={{ color: '#444' }}>暂无日志内容，点击"刷新"加载</span>}
                  </pre>
                )}
              </div>
            )
          }
        ]}
      />
    </Modal>
  )
}
