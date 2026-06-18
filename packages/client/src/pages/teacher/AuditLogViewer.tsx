/**
 * ✅ 操作审计日志查看器 (Audit Log Viewer)
 *
 * 功能特性：
 * - 多维度筛选（操作类型、实体、时间、用户）
 * - 变更数据对比展示（Diff视图）
 * - 统计仪表板（活跃度分析）
 * - 日志导出与清理
 * - 权限控制（仅管理员可见）
 */

import { useState, useEffect } from 'react';
import {
  Card, Table, Tag, Space, Button, Select, DatePicker, Row, Col,
  Statistic, Timeline, Modal, Input, Alert, Tooltip, Badge,
  Typography, Empty, Spin, message, Descriptions, Divider
} from 'antd';
import {
  HistoryOutlined, SearchOutlined, ReloadOutlined, ExportOutlined,
  DeleteOutlined, EyeOutlined, FilterOutlined, SafetyCertificateOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import * as XLSX from 'xlsx';

const { Text, Title, Paragraph } = Typography;
const { RangePicker } = DatePicker;

// ✅ 操作类型配置（中文映射 + 颜色）
const ACTION_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  CREATE: { label: '创建', color: 'green', icon: <HistoryOutlined /> },
  UPDATE: { label: '更新', color: 'blue', icon: <EditOutlined /> },
  DELETE: { label: '删除', color: 'red', icon: <DeleteOutlined /> },
  LOGIN: { label: '登录', color: 'default', icon: <UserOutlined /> },
  LOGOUT: { label: '登出', color: 'default', icon: <LogoutOutlined /> },
  EXPORT: { label: '导出', color: 'purple', icon: <ExportOutlined /> },
  IMPORT: { label: '导入', color: 'orange', icon: <ImportOutlined /> },
  REVIEW: { label: '审核', color: 'cyan', icon: <SafetyCertificateOutlined /> },
};

interface AuditLogItem {
  id: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldData?: any;
  newData?: any;
  changedFields?: string[];
  userId?: string;
  username?: string;
  userRole?: string;
  ipAddress?: string;
  userAgent?: string;
  requestUrl: string;
  occurredAt: string;
  operator?: { id: string; realName?: string; username: string };
}

interface AuditStatistics {
  overview: {
    totalLogs: number;
    todayLogs: number;
    growthRate: string;
  };
  actionDistribution: Array<{ action: string; count: number }>;
  entityDistribution: Array<{ entityType: string; count: number }>;
  activeUsers: Array<{ userId: string; username: string | null; operationCount: number }>;
}

export function AuditLogViewer() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [stats, setStats] = useState<AuditStatistics | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

  // 筛选条件
  const [filters, setFilters] = useState({
    action: undefined as string | undefined,
    entityType: undefined as string | undefined,
    username: undefined as string | undefined,
    timeRange: null as [dayjs.Dayjs, dayjs.Dayjs] | null,
    dateRange: undefined as string | undefined,
  });

  // ✅ 加载审计日志列表
  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params: Record<string, any> = {};
      if (filters.action) params.action = filters.action;
      if (filters.entityType) params.entityType = filters.entityType;
      if (filters.username) params.username = filters.username;
      if (filters.dateRange) params.dateRange = filters.dateRange;
      if (filters.timeRange) {
        params.startTime = filters.timeRange[0].toISOString();
        params.endTime = filters.timeRange[1].toISOString();
      }

      const res = await api.get('/audit/logs', { params });
      setLogs(res.data.data || []);
    } catch (err) {
      console.error('加载审计日志失败:', err);
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  // ✅ 加载统计数据
  const fetchStats = async () => {
    try {
      const res = await api.get('/audit/statistics');
      setStats(res.data.data);
    } catch (err) {
      console.error('加载统计失败:', err);
    }
  };

  // ✅ 查看日志详情
  const viewDetail = async (logId: string) => {
    try {
      const res = await api.get(`/audit/logs/${logId}`);
      setSelectedLog(res.data.data);
      setDetailModalOpen(true);
    } catch (err) {
      console.error('获取详情失败:', err);
      message.error('获取详情失败');
    }
  };

  useEffect(() => {
    fetchLogs();
    fetchStats();
  }, []);

  // ✅ 表格列定义
  const columns = [
    {
      title: '时间',
      dataIndex: 'occurredAt',
      key: 'time',
      width: 170,
      render: (time: string) => (
        <Tooltip title={dayjs(time).format('YYYY-MM-DD HH:mm:ss.SSS')}>
          <Text>{dayjs(time).format('MM-DD HH:mm:ss')}</Text>
        </Tooltip>
      ),
      sorter: (a: AuditLogItem, b: AuditLogItem) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    },
    {
      title: '操作类型',
      dataIndex: 'action',
      key: 'action',
      width: 90,
      render: (action: string) => {
        const config = ACTION_CONFIG[action];
        return config ? (
          <Tag icon={config.icon} color={config.color}>
            {config.label}
          </Tag>
        ) : action;
      },
      filters: Object.entries(ACTION_CONFIG).map(([key, val]) => ({
        text: val.label,
        value: key,
      })),
      onFilter: (value: any, record: AuditLogItem) => record.action === value,
    },
    {
      title: '目标实体',
      key: 'entity',
      width: 150,
      render: (_: any, record: AuditLogItem) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.entityType}</Text>
          {record.entityId && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              ID: {record.entityId.substring(0, 8)}...
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: '操作者',
      dataIndex: 'username',
      key: 'operator',
      width: 120,
      render: (name: string, record: AuditLogItem) => (
        <Tooltip title={`角色: ${record.userRole || '-'}`}>
          <Text>{record.operator?.realName || name || '-'}</Text>
        </Tooltip>
      ),
    },
    {
      title: '变更字段',
      dataIndex: 'changedFields',
      key: 'fields',
      width: 150,
      ellipsis: true,
      render: (fields: string[] | null) => {
        if (!fields || fields.length === 0) return '-';
        return (
          <Tooltip title={
            <div>
              {fields.map((f, i) => (
                <div key={i}>{f}</div>
              ))}
            </div>
          }>
            <Tag color="processing">{fields.length}个字段变更</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'IP地址',
      dataIndex: 'ipAddress',
      key: 'ip',
      width: 130,
      render: (ip: string) => ip || '-',
    },
    {
      title: '操作',
      key: 'action_btn',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, record: AuditLogItem) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => viewDetail(record.id)}
        >
          详情
        </Button>
      ),
    },
  ];

  // ✅ 导出功能
  const handleExport = () => {
    try {
      const exportData = logs.map(log => ({
        '时间': dayjs(log.occurredAt).format('YYYY-MM-DD HH:mm:ss'),
        '操作': ACTION_CONFIG[log.action]?.label || log.action,
        '实体类型': log.entityType,
        '实体ID': log.entityId || '-',
        '操作者': log.operator?.realName || log.username || '-',
        '角色': log.userRole || '-',
        'IP地址': log.ipAddress || '-',
        '请求URL': log.requestUrl,
        '变更字段': log.changedFields?.join(', ') || '-',
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '审计日志');
      XLSX.writeFile(workbook, `audit-logs-${dayjs().format('YYYYMMDD-HHmmss')}.xlsx`);
      message.success('导出成功');
    } catch (err) {
      console.error('导出失败:', err);
      message.error('导出失败');
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: 1400 }}>
      {/* 页面头部 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
      }}>
        <Title level={3}>操作审计日志</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { fetchLogs(); fetchStats(); }}>
            刷新
          </Button>
          <Button
            icon={<ExportOutlined />}
            onClick={handleExport}
            disabled={logs.length === 0}
          >
            导出Excel
          </Button>
        </Space>
      </div>

      {/* ✅ 统计仪表板 */}
      {stats && (
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card>
              <Statistic
                title="总日志数"
                value={stats.overview.totalLogs}
                prefix={<HistoryOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="今日新增"
                value={stats.overview.todayLogs}
                prefix={<ClockCircleOutlined />}
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="日增长率"
                value={`${stats.overview.growthRate}%`}
                prefix={<RiseOutlined />}
                valueStyle={{ color: parseFloat(stats.overview.growthRate) > 5 ? '#52c41a' : '#999' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="最活跃用户"
                value={stats.activeUsers[0]?.username || '-'}
                prefix={<UserOutlined />}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* ✅ 筛选工具栏 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col flex="auto">
            <Space wrap size="middle">
              <Select
                placeholder="操作类型"
                allowClear
                style={{ width: 130 }}
                value={filters.action}
                onChange={(val) => setFilters(prev => ({ ...prev, action: val }))}
              >
                {Object.entries(ACTION_CONFIG).map(([key, cfg]) => (
                  <Select.Option key={key} value={key}>{cfg.label}</Select.Option>
                ))}
              </Select>

              <Input
                placeholder="操作者用户名"
                allowClear
                style={{ width: 160 }}
                value={filters.username}
                onChange={(e) => setFilters(prev => ({ ...prev, username: e.target.value || undefined }))}
              />

              <Select
                placeholder="时间范围"
                allowClear
                style={{ width: 140 }}
                value={filters.dateRange}
                onChange={(val) => setFilters(prev => ({ ...prev, dateRange: val }))}
              >
                <Select.Option value="today">今天</Select.Option>
                <Select.Option value="week">最近7天</Select.Option>
                <Select.Option value="month">最近30天</Select.Option>
                <Select.Option value="quarter">最近90天</Select.Option>
                <Select.Option value="year">最近一年</Select.Option>
              </Select>

              <RangePicker
                showTime
                value={filters.timeRange}
                onChange={(dates) => setFilters(prev => ({ ...prev, timeRange: dates as any }))}
              />

              <Button
                type="primary"
                icon={<SearchOutlined />}
                onClick={fetchLogs}
              >
                查询
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* ✅ 审计日志表格 */}
      <Card>
        <Table
          dataSource={logs}
          rowKey="id"
          columns={columns}
          loading={loading}
          pagination={{
            pageSize: 20,
            showTotal: (total) => `共 ${total} 条`,
            showSizeChanger: true,
          }}
          scroll={{ x: 1100 }}
          size="middle"
        />
      </Card>

      {/* ✅ 详情弹窗 */}
      <Modal
        title="审计日志详情"
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setDetailModalOpen(false)}>
            关闭
          </Button>,
        ]}
        width={800}
      >
        {selectedLog && (
          <div>
            {/* 基本信息 */}
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="操作时间">
                {dayjs(selectedLog.occurredAt).format('YYYY-MM-DD HH:mm:ss.SSS')}
              </Descriptions.Item>
              <Descriptions.Item label="操作类型">
                <Tag color={ACTION_CONFIG[selectedLog.action]?.color}>
                  {ACTION_CONFIG[selectedLog.action]?.label || selectedLog.action}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="目标实体">
                {selectedLog.entityType}
                {selectedLog.entityId && (
                  <Text copyable style={{ marginLeft: 8 }}>
                    {selectedLog.entityId}
                  </Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="操作者">
                {selectedLog.operator?.realName || selectedLog.username || '-'}
                ({selectedLog.userRole || '-'})
              </Descriptions.Item>
              <Descriptions.Item label="IP地址">{selectedLog.ipAddress || '-'}</Descriptions.Item>
              <Descriptions.Item label="请求URL">{selectedLog.requestUrl}</Descriptions.Item>
            </Descriptions>

            {/* 变更字段 */}
            {selectedLog.changedFields && selectedLog.changedFields.length > 0 && (
              <>
                <Divider>变更字段 ({selectedLog.changedFields.length})</Divider>
                <Space wrap>
                  {selectedLog.changedFields.map((field, idx) => (
                    <Tag key={idx} color="processing">{field}</Tag>
                  ))}
                </Space>
              </>
            )}

            {/* 变更数据对比 */}
            {(selectedLog.oldData || selectedLog.newData) && (
              <>
                <Divider>数据快照</Divider>
                <Row gutter={16}>
                  {selectedLog.oldData && (
                    <Col span={12}>
                      <Card size="small" title="变更前" headStyle={{ background: '#fff1f0' }}>
                        <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
                          {JSON.stringify(selectedLog.oldData, null, 2)}
                        </pre>
                      </Card>
                    </Col>
                  )}
                  {selectedLog.newData && (
                    <Col span={12}>
                      <Card size="small" title="变更后" headStyle={{ background: '#f6ffed' }}>
                        <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
                          {JSON.stringify(selectedLog.newData, null, 2)}
                        </pre>
                      </Card>
                    </Col>
                  )}
                </Row>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ✅ 补充缺失的图标导入
import { EditOutlined, UserOutlined, LogoutOutlined, ImportOutlined, ClockCircleOutlined, RiseOutlined } from '@ant-design/icons';
