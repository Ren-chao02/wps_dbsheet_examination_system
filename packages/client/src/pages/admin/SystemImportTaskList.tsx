import { useEffect, useState, useCallback } from 'react';
import { Table, Tag, Button, message, Space, Select, Typography } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import type { ImportTask, PaginatedResponse } from '../../types';

const { Text } = Typography;

const statusConfig: Record<string, { color: string; text: string }> = {
  PENDING: { color: 'blue', text: '等待中' },
  PROCESSING: { color: 'processing', text: '处理中' },
  FINISHED: { color: 'green', text: '已完成' },
  FAILED: { color: 'red', text: '失败' },
};

const typeConfig: Record<string, string> = {
  student_import: '学生导入',
  account: '账户导入',
};

export default function SystemImportTaskList() {
  const [data, setData] = useState<PaginatedResponse<ImportTask>>({
    data: [], total: 0, page: 1, pageSize: 10,
  });
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string | undefined>();

  const fetchTasks = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: any = { page, pageSize: 10, scope: 'all' };
      if (typeFilter) params.type = typeFilter;
      const res = await api.get<PaginatedResponse<ImportTask>>('/import-tasks', { params });
      setData(res.data);
    } catch {
      message.error('加载导入任务列表失败');
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleDownloadError = async (task: ImportTask) => {
    try {
      const response = await api.get(`/import-tasks/${task.id}/error-file`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${task.fileName}_错误记录.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      message.error('下载失败记录失败');
    }
  };

  const handleDownloadFile = async (task: ImportTask) => {
    try {
      const response = await api.get(`/import-tasks/${task.id}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', task.fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      message.error('下载文件失败');
    }
  };

  const columns = [
    {
      title: '任务名称', dataIndex: 'taskName', key: 'taskName', width: 140,
      render: (v: string | null) => v || '—',
    },
    {
      title: '文件名', dataIndex: 'fileName', key: 'fileName', ellipsis: true,
    },
    {
      title: '类型', dataIndex: 'type', key: 'type', width: 100,
      render: (v: string) => <Tag>{typeConfig[v] || v}</Tag>,
    },
    {
      title: '创建者', dataIndex: 'creator', key: 'creator', width: 100,
      render: (v: { realName?: string; username: string } | null) =>
        v ? (v.realName || v.username) : '—',
    },
    {
      title: '总行数', dataIndex: 'totalRows', key: 'totalRows', width: 80, align: 'center' as const,
    },
    {
      title: '成功', dataIndex: 'successRows', key: 'successRows', width: 80, align: 'center' as const,
      render: (v: number) => <span style={{ color: '#52c41a' }}>{v}</span>,
    },
    {
      title: '失败', dataIndex: 'failedRows', key: 'failedRows', width: 80, align: 'center' as const,
      render: (v: number) => v > 0 ? <span style={{ color: '#ff4d4f' }}>{v}</span> : v,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: string) => {
        const cfg = statusConfig[v] || { color: 'default', text: v };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 150,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—',
    },
    {
      title: '完成时间', dataIndex: 'completedAt', key: 'completedAt', width: 150,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—',
    },
    {
      title: '操作', key: 'actions', width: 200, fixed: 'right' as const,
      render: (_: any, r: ImportTask) => (
        <Space>
          {r.status === 'FINISHED' && r.downloadUrl && (
            <Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownloadFile(r)}>
              下载文件
            </Button>
          )}
          {r.failedRows > 0 && (
            <Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownloadError(r)}>
              失败数据
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>导入导出任务</h2>
        <Space>
          <Select
            allowClear
            placeholder="任务类型"
            style={{ width: 140 }}
            value={typeFilter}
            onChange={(v) => setTypeFilter(v)}
            options={[
              { value: 'student_import', label: '学生导入' },
              { value: 'account', label: '账户导入' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => fetchTasks(data.page)}>刷新</Button>
        </Space>
      </div>

      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        查看系统中所有的导入导出任务，管理员可以下载任意任务的结果文件或失败数据。
      </Text>

      <Table
        dataSource={data.data}
        columns={columns}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1300 }}
        pagination={{
          current: data.page,
          total: data.total,
          pageSize: data.pageSize,
          showSizeChanger: false,
          onChange: (page) => fetchTasks(page),
        }}
      />
    </div>
  );
}
