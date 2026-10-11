/**
 * 考试 / 练习页右侧「WPS 多维表格」面板（两种展示方式共用一套逻辑）
 *
 * 背景：内嵌能否显示表格，取决于该文档的分享权限与浏览器三方 Cookie 策略
 * （实测同一批分配表里，有的匿名可渲染、有的直接跳 WPS 登录页），内嵌天然可能失败。
 * 因此本面板提供两种展示方式，学生可随时切换，且失败时一定有出路：
 *
 *   1. 内嵌模式：iframe 直接嵌在右侧（登录态可用时体验最好）；
 *   2. 独立窗口模式（工作台）：顶层命名窗口打开表格，登录/扫码/协作全部正常，
 *      并在右侧显示「实时数据面板」实时反映表格数据，做到人不在框里也能看到结果。
 *
 * 学生的选择会按 storageKey 记忆，下次进入同一场考试直接沿用，不用重复踩坑。
 */
import { useCallback } from 'react';
import { Button, Card, Space, Spin, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ExportOutlined,
  LinkOutlined,
  ReloadOutlined,
  TableOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useWpsEmbed } from '../../hooks/useWpsEmbed';
import { WpsLivePreview } from './WpsLivePreview';

const { Text, Title } = Typography;

interface WpsTablePanelProps {
  /** 该考生分配的多维表格分享链接 */
  shareUrl: string | null;
  /** 偏好记忆键与命名窗口标识：考试传 `exam:<id>`，练习传 `practice` */
  storageKey: string;
  /** 实时数据面板接口（可选），如 /my-exams/<id>/wps-preview */
  previewEndpoint?: string | null;
  /** 工作台窗口开/关：调用方据此豁免切屏计数、挂起全屏守护 */
  onWorkbenchChange?: (open: boolean) => void;
}

export function WpsTablePanel({
  shareUrl,
  storageKey,
  previewEndpoint,
  onWorkbenchChange,
}: WpsTablePanelProps) {
  const {
    reloadKey,
    showSpinner,
    showFallback,
    reload,
    handleIframeLoad,
    handleIframeError,
    mode,
    setMode,
    openWorkbench,
    focusWorkbench,
    workbenchOpen,
    popupBlocked,
  } = useWpsEmbed(shareUrl, { timeoutMs: 15000, storageKey, onWorkbenchChange });

  const switchToWorkbench = useCallback(() => {
    setMode('workbench');
  }, [setMode]);

  const switchToEmbed = useCallback(() => {
    setMode('embed');
  }, [setMode]);

  const handleOpenWorkbench = useCallback(() => {
    openWorkbench();
  }, [openWorkbench]);

  if (!shareUrl) return null;

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#f0f2f5' }}>
      {/* ═══ 工具栏 ═══ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          padding: '8px 16px',
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          flexShrink: 0,
        }}
      >
        <Space size={8} style={{ whiteSpace: 'nowrap' }}>
          <Text strong style={{ fontSize: 14 }}>
            <TableOutlined style={{ marginRight: 8 }} />
            多维表格
          </Text>
          {mode === 'workbench' && <Tag color="blue">独立窗口模式</Tag>}
        </Space>
        <Space wrap>
          {mode === 'embed' ? (
            <>
              <Button icon={<ReloadOutlined />} onClick={reload}>
                刷新表格
              </Button>
              <Button type="primary" icon={<ExportOutlined />} onClick={switchToWorkbench}>
                改用独立窗口
              </Button>
            </>
          ) : (
            <>
              <Button icon={<LinkOutlined />} onClick={switchToEmbed}>
                切回内嵌显示
              </Button>
              {workbenchOpen ? (
                <Button type="primary" icon={<ExportOutlined />} onClick={focusWorkbench}>
                  回到表格窗口
                </Button>
              ) : (
                <Button type="primary" icon={<ExportOutlined />} onClick={handleOpenWorkbench}>
                  打开我的多维表格
                </Button>
              )}
            </>
          )}
        </Space>
      </div>

      {/* ═══ 主体 ═══ */}
      {mode === 'embed' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            {showSpinner && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#f0f2f5',
                  zIndex: 5,
                }}
              >
                <Spin tip="正在加载 WPS 多维表格..." />
              </div>
            )}

            {showFallback && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#f0f2f5',
                  zIndex: 6,
                  padding: 40,
                  textAlign: 'center',
                }}
              >
                <TableOutlined style={{ fontSize: 48, color: '#1890ff', marginBottom: 16 }} />
                <Title level={5} style={{ marginBottom: 8 }}>
                  表格未能在页面内显示
                </Title>
                <Text style={{ color: '#666', marginBottom: 20, lineHeight: 1.9 }}>
                  浏览器安全策略可能阻止了内嵌加载，或表格提示需要登录 WPS。
                  <br />
                  点下方「改用独立窗口」，在新窗口登录并操作表格，完成后返回本页交卷
                  （判分读取的是表格数据，与你在哪里操作无关）。
                </Text>
                <Space>
                  <Button size="large" icon={<ReloadOutlined />} onClick={reload}>
                    刷新表格
                  </Button>
                  <Button type="primary" size="large" icon={<ExportOutlined />} onClick={switchToWorkbench}>
                    改用独立窗口
                  </Button>
                </Space>
              </div>
            )}

            <iframe
              key={reloadKey}
              src={shareUrl}
              style={{ width: '100%', height: '100%', border: 'none' }}
              title="WPS 多维表格"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              referrerPolicy="no-referrer"
            />
          </div>

          {/* 内嵌模式下的逃生入口：框内是登录页/空白时一眼可见 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '6px 16px',
              background: '#fff',
              borderTop: '1px solid #f0f0f0',
              flexShrink: 0,
            }}
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              框内若是「未登录 / 文档已删除」或一直空白，请改用独立窗口
            </Text>
            <Button size="small" onClick={switchToWorkbench}>
              改用独立窗口
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* 工作台：打开/回到表格窗口 */}
          <Card size="small" style={{ margin: 12, flexShrink: 0 }}>
            <Title level={5} style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {workbenchOpen ? '表格已在独立窗口打开' : '在独立窗口中打开多维表格'}
              {workbenchOpen && (
                <Tag icon={<CheckCircleOutlined />} color="success" style={{ marginInlineEnd: 0 }}>
                  已打开
                </Tag>
              )}
            </Title>
            <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.8 }}>
              {workbenchOpen
                ? '请在表格窗口完成作答，本页会实时同步表格数据；交卷请回到本页。'
                : '首次打开需要登录 WPS 账号，登录后本机整场考试都无需重复登录。'}
            </Text>
            {popupBlocked && (
              <div style={{ marginTop: 8 }}>
                <Text type="danger" style={{ fontSize: 12 }}>
                  <WarningOutlined style={{ marginRight: 4 }} />
                  窗口被浏览器拦截：请点击地址栏右侧的「弹窗已拦截」图标允许本站弹窗后重试
                </Text>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              {workbenchOpen ? (
                <Button type="primary" icon={<ExportOutlined />} onClick={focusWorkbench}>
                  回到表格窗口
                </Button>
              ) : (
                <Button type="primary" icon={<ExportOutlined />} onClick={handleOpenWorkbench}>
                  打开我的多维表格
                </Button>
              )}
            </div>
          </Card>

          {/* 实时数据面板：主页面始终能看到表格真实数据 */}
          <div style={{ flex: 1, minHeight: 0, margin: '0 12px 12px', background: '#fff', border: '1px solid #f0f0f0', borderRadius: 6, overflow: 'hidden' }}>
            {previewEndpoint ? (
              <WpsLivePreview endpoint={previewEndpoint} enabled />
            ) : (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <Text type="secondary">
                  请在新窗口完成表格操作，操作结果由系统直接读取，无需在此查看。
                </Text>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
