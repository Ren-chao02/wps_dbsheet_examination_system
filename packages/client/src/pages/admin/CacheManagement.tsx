import { useEffect, useState } from 'react';
import { Card, Button, Table, Space, message, Popconfirm, Typography } from 'antd';
import { ClearOutlined, ReloadOutlined, DatabaseOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { CacheInfo } from '../../types';

const { Text } = Typography;

export default function CacheManagement() {
  const [cacheInfo, setCacheInfo] = useState<CacheInfo>({ totalEntries: 0, entries: [] });
  const [loading, setLoading] = useState(true);

  const fetchCache = async () => {
    setLoading(true);
    try {
      const res = await api.get('/cache');
      setCacheInfo(res.data.data);
    } catch {
      message.error('加载缓存信息失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCache(); }, []);

  const handleClear = async () => {
    try {
      await api.post('/cache/clear');
      message.success('缓存已清理');
      fetchCache();
    } catch {
      message.error('清理缓存失败');
    }
  };

  const handleRefresh = async () => {
    try {
      await api.post('/cache/refresh');
      message.success('缓存已刷新');
      fetchCache();
    } catch {
      message.error('刷新缓存失败');
    }
  };

  const columns = [
    { title: '缓存键', dataIndex: 'key', key: 'key', width: 200 },
    {
      title: '大小', dataIndex: 'size', key: 'size', width: 100,
      render: (v: number) => `${v} B`,
    },
    {
      title: '存活时间', dataIndex: 'age', key: 'age', width: 120,
      render: (v: number) => {
        if (v < 60) return `${v}秒`;
        if (v < 3600) return `${Math.floor(v / 60)}分钟`;
        return `${Math.floor(v / 3600)}小时`;
      },
    },
    {
      title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 180,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>缓存管理</h2>
        <Space>
          <Popconfirm title="确定清理所有缓存？" onConfirm={handleClear}>
            <Button icon={<ClearOutlined />} danger>清理缓存</Button>
          </Popconfirm>
          <Popconfirm title="确定刷新缓存？" onConfirm={handleRefresh}>
            <Button type="primary" icon={<ReloadOutlined />}>刷新缓存</Button>
          </Popconfirm>
        </Space>
      </div>

      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        管理系统缓存数据，包括查看缓存状态、清理过期缓存、刷新缓存数据等操作。
      </Text>

      <Card
        title={<Space><DatabaseOutlined />缓存状态</Space>}
        extra={<Text>共 {cacheInfo.totalEntries} 条缓存</Text>}
      >
        <Table
          dataSource={cacheInfo.entries}
          columns={columns}
          rowKey="key"
          loading={loading}
          pagination={false}
          locale={{ emptyText: '当前没有缓存数据' }}
        />
      </Card>
    </div>
  );
}
