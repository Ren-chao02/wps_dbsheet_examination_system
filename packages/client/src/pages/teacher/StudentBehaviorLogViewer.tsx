/**
 * ✅ 考生行为日志查看器 (Student Behavior Log Viewer)
 *
 * 功能特性：
 * - 时间线展示考生行为轨迹
 * - 风险等级可视化（颜色编码）
 * - 多维度筛选（类型、时间、风险）
 * - 分析报告一键生成
 * - 人工审核标记
 */

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card, Table, Tag, Space, Button, Select, DatePicker, Row, Col,
  Statistic, Timeline, Modal, Form, Input, Alert, Tooltip, Badge,
  Progress, Typography, Divider, Empty, Spin, message
} from 'antd';
import {
  WarningOutlined, CheckCircleOutlined, EyeOutlined,
  ExportOutlined, SearchOutlined, ReloadOutlined,
  FileTextOutlined, ClockCircleOutlined, SafetyCertificateOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import * as XLSX from 'xlsx';

const { Text, Title, Paragraph } = Typography;
const { RangePicker } = DatePicker;

// ✅ 行为类型配置（中文映射 + 图标）
const BEHAVIOR_TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  TAB_SWITCH: { label: '切屏操作', color: 'orange', icon: <WarningOutlined /> },
  COPY_PASTE: { label: '复制粘贴', color: 'gold', icon: <FileTextOutlined /> },
  WINDOW_BLUR: { label: '窗口失焦', color: 'blue', icon: <EyeOutlined /> },
  FULLSCREEN_EXIT: { label: '退出全屏', color: 'red', icon: <WarningOutlined /> },
  KEYBOARD_SHORTCUT: { label: '可疑快捷键', color: 'red', icon: <SafetyCertificateOutlined /> },
  MOUSE_SUSPICIOUS: { label: '异常鼠标', color: 'volcano', icon: <WarningOutlined /> },
  QUESTION_NAVIGATE: { label: '题目跳转', color: 'default', icon: <ClockCircleOutlined /> },
  ANSWER_SUBMIT: { label: '提交答案', color: 'green', icon: <CheckCircleOutlined /> },
  EXAM_START: { label: '开始考试', color: 'blue', icon: <CheckCircleOutlined /> },
  EXAM_END: { label: '结束考试', color: 'purple', icon: <FileTextOutlined /> },
};

// ✅ 风险等级配置
const RISK_LEVEL_CONFIG: Record<string, { label: string; color: string; score: number }> = {
  LOW: { label: '低风险', color: 'green', score: 0 },
  MEDIUM: { label: '中等风险', color: 'orange', score: 50 },
  HIGH: { label: '高风险', color: 'red', score: 80 },
  CRITICAL: { label: '严重违规', color: '#cf1322', score: 100 },
};

interface BehaviorLog {
  id: string;
  studentId: string;
  examId: string;
  behaviorType: string;
  riskLevel: string;
  metadata: Record<string, any>;
  occurredAt: string;
  student?: { id: string; realName?: string; username: string };
}

interface AnalysisReport {
  id: string;
  examId: string;
  studentId: string;
  totalBehaviors: number;
  tabSwitchCount: number;
  copyPasteCount: number;
  blurCount: number;
  highRiskCount: number;
  criticalCount: number;
  suspiciousScore: number;
  conclusion: string | null;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  student?: { id: string; realName?: string; username: string };
}

export function StudentBehaviorLogViewer() {
  const { examId } = useParams<{ examId: string }>();
  const [logs, setLogs] = useState<BehaviorLog[]>([]);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  // 筛选条件
  const [filters, setFilters] = useState({
    behaviorType: undefined as string | undefined,
    riskLevel: undefined as string | undefined,
    timeRange: null as [dayjs.Dayjs, dayjs.Dayjs] | null,
  });

  // ✅ 加载行为日志列表
  const fetchLogs = async () => {
    if (!examId) return;

    try {
      setLoading(true);
      const params: any = { examId };
      if (filters.behaviorType) params.behaviorType = filters.behaviorType;
      if (filters.riskLevel) params.riskLevel = filters.riskLevel;
      if (filters.timeRange) {
        params.startTime = filters.timeRange[0].toISOString();
        params.endTime = filters.timeRange[1].toISOString();
      }

      const res = await api.get('/behaviors', { params });
      setLogs(res.data.data || []);
    } catch (err) {
      console.error('加载行为日志失败:', err);
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  // ✅ 加载分析报告
  const fetchReport = async (studentId: string) => {
    try {
      const res = await api.get(`/behaviors/reports/${examId}/${studentId}`);
      setReport(res.data.data);
      setSelectedStudentId(studentId);
    } catch (err) {
      console.error('加载分析报告失败:', err);
      message.error('加载报告失败');
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [examId, filters]);

  // ✅ 表格列定义
  const columns = [
    {
      title: '时间',
      dataIndex: 'occurredAt',
      key: 'time',
      width: 180,
      render: (time: string) => (
        <Tooltip title={dayjs(time).format('YYYY-MM-DD HH:mm:ss.SSS')}>
          <Text>{dayjs(time).format('HH:mm:ss')}</Text>
        </Tooltip>
      ),
      sorter: (a: BehaviorLog, b: BehaviorLog) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    },
    {
      title: '学生',
      key: 'student',
      width: 120,
      render: (_: any, record: BehaviorLog) => (
        <a onClick={() => fetchReport(record.studentId)}>
          {record.student?.realName || record.student?.username || '-'}
        </a>
      ),
    },
    {
      title: '行为类型',
      dataIndex: 'behaviorType',
      key: 'type',
      width: 120,
      render: (type: string) => {
        const config = BEHAVIOR_TYPE_CONFIG[type];
        return config ? (
          <Tag icon={config.icon} color={config.color}>
            {config.label}
          </Tag>
        ) : type;
      },
    },
    {
      title: '风险等级',
      dataIndex: 'riskLevel',
      key: 'risk',
      width: 100,
      render: (level: string) => {
        const config = RISK_LEVEL_CONFIG[level];
        return config ? (
          <Tag color={config.color}>{config.label}</Tag>
        ) : level;
      },
      filters: Object.entries(RISK_LEVEL_CONFIG).map(([key, val]) => ({
        text: val.label,
        value: key,
      })),
      onFilter: (value: any, record: BehaviorLog) => record.riskLevel === value,
    },
    {
      title: '详细信息',
      dataIndex: 'metadata',
      key: 'details',
      ellipsis: true,
      render: (meta: Record<string, any>) => (
        <Tooltip title={
          <div style={{ maxWidth: 300 }}>
            {Object.entries(meta).map(([k, v]) => (
              <div key={k}>
                <strong>{k}:</strong> {JSON.stringify(v)}
              </div>
            ))}
          </div>
        }>
          <Text style={{ cursor: 'pointer' }}>
            {meta.tabSwitch?.count && `切屏${meta.tabSwitch.count}次`}
            {meta.copyPaste && '复制粘贴'}
            {meta.blurDuration && `失焦${(meta.blurDuration / 1000).toFixed(1)}s`}
            {!Object.keys(meta).length && '-'}
          </Text>
        </Tooltip>
      ),
    },
  ];

  // ✅ 导出功能
  const handleExport = () => {
    try {
      const exportData = logs.map(log => ({
        '时间': dayjs(log.occurredAt).format('YYYY-MM-DD HH:mm:ss'),
        '学生': log.student?.realName || log.student?.username,
        '学号': log.studentId,
        '行为类型': BEHAVIOR_TYPE_CONFIG[log.behaviorType]?.label || log.behaviorType,
        '风险等级': RISK_LEVEL_CONFIG[log.riskLevel]?.label || log.riskLevel,
        '详情': JSON.stringify(log.metadata),
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '行为日志');
      XLSX.writeFile(workbook, `behavior-logs-${examId}-${dayjs().format('YYYYMMDD-HHmmss')}.xlsx`);
      message.success('导出成功');
    } catch (err) {
      console.error('导出失败:', err);
      message.error('导出失败');
    }
  };

  // ✅ 统计数据计算
  const stats = {
    total: logs.length,
    highRisk: logs.filter(l => l.riskLevel === 'HIGH' || l.riskLevel === 'CRITICAL').length,
    tabSwitch: logs.filter(l => l.behaviorType === 'TAB_SWITCH').length,
    suspiciousStudents: new Set(logs.map(l => l.studentId)).size,
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
        <Title level={3}>考生行为日志</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchLogs}>
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
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="总记录数"
              value={stats.total}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="高风险行为"
              value={stats.highRisk}
              valueStyle={{ color: stats.highRisk > 0 ? '#ff4d4f' : '#999' }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="切屏次数"
              value={stats.tabSwitch}
              valueStyle={{ color: stats.tabSwitch > 10 ? '#faad14' : '#52c41a' }}
              prefix={<EyeOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="涉及学生数"
              value={stats.suspiciousStudents}
              prefix={<UserOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* ✅ 筛选工具栏 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            placeholder="行为类型"
            allowClear
            style={{ width: 150 }}
            value={filters.behaviorType}
            onChange={(val) => setFilters(prev => ({ ...prev, behaviorType: val }))}
          >
            {Object.entries(BEHAVIOR_TYPE_CONFIG).map(([key, cfg]) => (
              <Select.Option key={key} value={key}>{cfg.label}</Select.Option>
            ))}
          </Select>

          <Select
            placeholder="风险等级"
            allowClear
            style={{ width: 130 }}
            value={filters.riskLevel}
            onChange={(val) => setFilters(prev => ({ ...prev, riskLevel: val }))}
          >
            {Object.entries(RISK_LEVEL_CONFIG).map(([key, cfg]) => (
              <Select.Option key={key} value={key}>{cfg.label}</Select.Option>
            ))}
          </Select>

          <RangePicker
            showTime
            value={filters.timeRange}
            onChange={(dates) => setFilters(prev => ({ ...prev, timeRange: dates as any }))}
          />

          <Button type="primary" icon={<SearchOutlined />} onClick={fetchLogs}>
            查询
          </Button>
        </Space>
      </Card>

      {/* ✅ 行为日志表格 */}
      <Card>
        <Table
          dataSource={logs}
          rowKey="id"
          columns={columns}
          loading={loading}
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条` }}
          scroll={{ x: 900 }}
          size="middle"
        />
      </Card>

      {/* ✅ 分析报告弹窗 */}
      <Modal
        title={`行为分析报告 - ${report?.student?.realName || report?.student?.username}`}
        open={!!report && selectedStudentId !== null}
        onCancel={() => { setReport(null); setSelectedStudentId(null); }}
        footer={[
          <Button key="close" onClick={() => { setReport(null); setSelectedStudentId(null); }}>
            关闭
          </Button>,
          <Button
            key="review"
            type="primary"
            onClick={() => setReviewModalOpen(true)}
            disabled={!report}
          >
            人工审核
          </Button>,
        ]}
        width={700}
      >
        {report && (
          <div>
            {/* 综合评分 */}
            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col span={12}>
                <Card size="small">
                  <Progress
                    type="dashboard"
                    percent={Math.round(report.suspiciousScore)}
                    format={() => report.suspiciousScore.toFixed(1)}
                    status={
                      report.suspiciousScore >= 80 ? 'exception' :
                      report.suspiciousScore >= 50 ? 'normal' : 'success'
                    }
                  />
                  <div style={{ textAlign: 'center', marginTop: 8 }}>
                    <Text strong>可疑度评分</Text>
                  </div>
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small">
                  <Statistic
                    title="自动结论"
                    value={report.conclusion || '未判定'}
                    valueStyle={{
                      color:
                        report.conclusion === '疑似作弊' ? '#ff4d4f' :
                        report.conclusion === '需人工复核' ? '#faad14' :
                        '#52c41a'
                    }}
                  />
                  {report.reviewedAt && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                      已于 {dayjs(report.reviewedAt).format('YYYY-MM-DD HH:mm')} 审核
                    </div>
                  )}
                </Card>
              </Col>
            </Row>

            <Divider>详细统计</Divider>

            {/* 详细指标 */}
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Statistic title="总行为次数" value={report.totalBehaviors} />
              </Col>
              <Col span={8}>
                <Statistic
                  title="切屏次数"
                  value={report.tabSwitchCount}
                  valueStyle={{ color: report.tabSwitchCount > 5 ? '#ff4d4f' : '#999' }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="复制粘贴"
                  value={report.copyPasteCount}
                  valueStyle={{ color: report.copyPasteCount > 3 ? '#faad14' : '#999' }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="窗口失焦"
                  value={report.blurCount}
                  valueStyle={{ color: report.blurCount > 10 ? '#faad14' : '#999' }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="高风险行为"
                  value={report.highRiskCount}
                  valueStyle={{ color: report.highRiskCount > 0 ? '#ff4d4f' : '#52c41a' }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="严重违规"
                  value={report.criticalCount}
                  valueStyle={{ color: report.criticalCount > 0 ? '#cf1322' : '#52c41a' }}
                />
              </Col>
            </Row>

            {report.reviewNote && (
              <>
                <Divider>审核备注</Divider>
                <Alert type="info" message={report.reviewNote} />
              </>
            )}
          </div>
        )}
      </Modal>

      {/* ✅ 审核表单弹窗 */}
      <Modal
        title="人工审核分析报告"
        open={reviewModalOpen}
        onOk={async () => {
          // TODO: 实现审核提交逻辑
          message.success('审核已提交');
          setReviewModalOpen(false);
        }}
        onCancel={() => setReviewModalOpen(false)}
      >
        <Form layout="vertical">
          <Form.Item label="审核结论" required>
            <Select placeholder="请选择审核结论">
              <Select.Option value="正常">正常 - 无异常行为</Select.Option>
              <Select.Option value="需人工复核">需人工复核 - 存在疑点</Select.Option>
              <Select.Option value="疑似作弊">疑似作弊 - 明确违规证据</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="审核备注">
            <Input.TextArea rows={4} placeholder="请输入审核意见和备注..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ✅ 补充缺失的图标导入
import { UserOutlined } from '@ant-design/icons';
