/**
 * WPS 表格「实时数据面板」
 *
 * 用途：学生在独立窗口里操作多维表格时，本面板通过后端定时读取表格真实数据并渲染，
 * 让主页面始终能看到表格当前状态 —— 解决「表格加载不出来就完全失控」的问题。
 *
 * 实现要点：
 * - 只在页面可见时轮询（学生去表格窗口操作时本页 hidden，不浪费 WPS 接口配额），
 *   切回本页立即补一次，保证看到的不是陈旧数据；
 * - 读取失败只提示，不影响作答与判分（判分由后端直接读表格，与本面板无关）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Select, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import api from '../../services/api';

const { Text } = Typography;

const POLL_INTERVAL_MS = 5000;
const MAX_COLUMNS = 8;

interface PreviewPayload {
  sheetId: number;
  sheetName: string;
  sheets: { id: number; name: string }[];
  fields: { id: string; name: string; type: string }[];
  records: { id: string; fields: Record<string, unknown> }[];
  truncated: boolean;
  syncedAt: string;
}

interface WpsLivePreviewProps {
  /** 预览接口路径，如 /my-exams/<examId>/wps-preview */
  endpoint: string;
  /** 是否启用（无已分配表格时关闭） */
  enabled?: boolean;
}

/** 把多维表格的各种字段值转成可读文本（选择/关联/附件等可能是对象或数组） */
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item === null || item === undefined) return '';
        if (typeof item === 'object') {
          const obj = item as Record<string, any>;
          return String(obj.text ?? obj.name ?? obj.value ?? obj.title ?? JSON.stringify(obj));
        }
        return String(item);
      })
      .filter(Boolean)
      .join('、');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, any>;
    return String(obj.text ?? obj.name ?? obj.value ?? obj.title ?? JSON.stringify(obj));
  }
  return String(value);
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false });
  } catch {
    return '';
  }
}

export function WpsLivePreview({ endpoint, enabled = true }: WpsLivePreviewProps) {
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sheetId, setSheetId] = useState<string>('');
  const fetchingRef = useRef(false);

  const fetchPreview = useCallback(async () => {
    if (!enabled || fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    try {
      const res = await api.get(endpoint, {
        params: sheetId ? { sheetId } : undefined,
        timeout: 15000,
      });
      setPayload(res.data);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || '读取表格失败');
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, [endpoint, sheetId, enabled]);

  // 轮询：仅页面可见时进行；切回本页立即刷新一次
  useEffect(() => {
    if (!enabled) return;
    if (document.visibilityState === 'visible') fetchPreview();

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchPreview();
    }, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchPreview();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, fetchPreview]);

  if (!enabled) return null;

  // WPS v7 记录既可能以字段 id 为键、也可能以字段名为键（prefer_id 不同），故两处都查
  const readCell = (record: { fields: Record<string, unknown> }, field: { id: string; name: string }) => {
    const byId = record.fields?.[field.id];
    if (byId !== undefined && byId !== null) return byId;
    return record.fields?.[field.name];
  };

  const columns = (payload?.fields || []).slice(0, MAX_COLUMNS).map((field) => ({
    title: field.name,
    dataIndex: field.id,
    key: field.id,
    ellipsis: true,
    width: 120,
    render: (_: unknown, record: { fields: Record<string, unknown> }) =>
      formatCellValue(readCell(record, field)),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 面板头：表名 / 行数 / 同步状态 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          padding: '6px 12px',
          background: '#fafafa',
          borderBottom: '1px solid #f0f0f0',
          flexShrink: 0,
        }}
      >
        <Space size={8} wrap>
          <Text strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
            实时数据面板
          </Text>
          {payload && (
            <>
              <Select
                size="small"
                value={sheetId || String(payload.sheetId)}
                style={{ minWidth: 120 }}
                onChange={(value) => setSheetId(value)}
                options={payload.sheets.map((sheet) => ({
                  label: sheet.name,
                  value: String(sheet.id),
                }))}
                disabled={payload.sheets.length <= 1}
              />
              <Tag color="blue">{payload.records.length} 行{payload.truncated ? '+' : ''}</Tag>
            </>
          )}
        </Space>
        <Space size={8}>
          {payload && (
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              {formatTime(payload.syncedAt)} 同步
            </Text>
          )}
          <Tooltip title="立即刷新">
            <Button size="small" type="text" icon={loading ? <SyncOutlined spin /> : <ReloadOutlined />} onClick={fetchPreview} />
          </Tooltip>
        </Space>
      </div>

      {/* 表体 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff' }}>
        {error ? (
          <div style={{ padding: 12 }}>
            <Alert
              type="warning"
              showIcon
              message="暂时读不到表格数据"
              description={
                <span style={{ fontSize: 12, lineHeight: 1.8 }}>
                  {error}
                  <br />
                  这不影响你在表格里的操作，也不影响判分（判分由系统直接读取表格数据）。
                </span>
              }
            />
          </div>
        ) : !payload && loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin tip="正在读取表格数据..." />
          </div>
        ) : payload && payload.records.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="表格还没有数据，快去操作吧"
            style={{ marginTop: 40 }}
          />
        ) : payload ? (
          <Table
            size="small"
            rowKey="id"
            columns={columns}
            dataSource={payload.records}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        ) : null}
      </div>
    </div>
  );
}
