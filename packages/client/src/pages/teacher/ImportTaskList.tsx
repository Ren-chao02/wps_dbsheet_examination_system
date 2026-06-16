import { useEffect, useState, useCallback } from 'react';
import { Table, Tag, Button, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import type { ImportTask, PaginatedResponse } from '../../types';

const statusConfig: Record<string, { color: string; text: string }> = {
  PENDING: { color: 'blue', text: '等待中' },
  PROCESSING: { color: 'processing', text: '处理中' },
  FINISHED: { color: 'green', text: '已完成' },
  FAILED: { color: 'red', text: '失败' },
};

export default function ImportTaskList() {
  const [data, setData] = useState<PaginatedResponse<ImportTask>>({ data: [], total: 0, page: 1, pageSize: 10 });
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const res = await api.get<PaginatedResponse<ImportTask>>('/import-tasks', {
        params: { page, pageSize: 10 },
      });
      setData(res.data);
    } catch {
      message.error('加载导入任务列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleDownloadError = async (task: ImportTask) => {
    try {
      const response = await api.get(`/import-tasks/${task.id}/error-file`, {
        responseType: 'blob',
      });
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

  const columns = [
    {
      title: '文件名', dataIndex: 'fileName', key: 'fileName', ellipsis: true,
    },
    {
      title: '类型', dataIndex: 'type', key: 'type', width: 100,
      render: (v: string) => v === 'student_import' ? '学生导入' : v,
    },
    {
      title: '总行数', dataIndex: 'totalRows', key: 'totalRows', width: 80, align: 'center' as const,
    },
    {
      title: '成功数', dataIndex: 'successRows', key: 'successRows', width: 80, align: 'center' as const,
      render: (v: number) => <span style={{ color: '#52c41a' }}>{v}</span>,
    },
    {
      title: '失败数', dataIndex: 'failedRows', key: 'failedRows', width: 80, align: 'center' as const,
      render: (v: number) => v > 0 ? <span style={{ color: '#ff4d4f' }}>{v}</span> : v,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => {
        const cfg = statusConfig[v] || { color: 'default', text: v };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—',
    },
    {
      title: '完成时间', dataIndex: 'completedAt', key: 'completedAt', width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—',
    },
    {
      title: '操作', key: 'actions', width: 120,
      render: (_: any, r: ImportTask) => (
        r.failedRows > 0 ? (
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => handleDownloadError(r)}
          >
            下载错误文件
          </Button>
        ) : null
      ),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>导入导出任务</h2>
      </div>

      <Table
        dataSource={data.data}
        columns={columns}
        rowKey="id"
        loading={loading}
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
