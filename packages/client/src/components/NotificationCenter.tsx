/**
 * ✅ 实时通知中心 (Notification Center)
 *
 * 功能特性：
 * - 铃铛图标 + 未读数红点
 * - 下拉通知列表（实时更新）
 * - 标记已读/全部已读
 * - WebSocket实时推送
 * - 偏好设置面板
 */

import { useState, useEffect, useRef } from 'react';
import {
  Badge, Dropdown, List, Avatar, Button, Space, Tag, Typography,
  Empty, Spin, Modal, Switch, message,
  Tooltip
} from 'antd';
import {
  BellOutlined, CheckOutlined, CheckSquareOutlined,
  SettingOutlined, ExclamationCircleOutlined, InfoCircleOutlined,
  WarningOutlined, FileTextOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import api from '../services/api';
import { useAuthStore } from '../stores/auth';
import { io, Socket } from 'socket.io-client';
import { getSocketURL } from '../config/socket-url';

// 扩展dayjs相对时间插件
dayjs.extend(relativeTime);

const { Text, Paragraph } = Typography;

// ✅ 通知类型配置
const TYPE_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  SYSTEM: { color: '#1890ff', icon: <InfoCircleOutlined />, label: '系统公告' },
  EXAM: { color: '#1677ff', icon: <FileTextOutlined />, label: '考试通知' },
  GRADE: { color: '#52c41a', icon: <FileTextOutlined />, label: '成绩发布' },
  ALERT: { color: '#ff4d4f', icon: <WarningOutlined />, label: '告警提醒' },
  AUDIT: { color: '#faad14', icon: <ExclamationCircleOutlined />, label: '审计通知' },
};

// ✅ 优先级配置
const PRIORITY_CONFIG: Record<string, { color: string; label: string }> = {
  LOW: { color: 'default', label: '普通' },
  MEDIUM: { color: 'blue', label: '一般' },
  HIGH: { color: 'orange', label: '重要' },
  URGENT: { color: 'red', label: '紧急' },
};

interface NotificationItem {
  id: string;
  type: string;
  priority: string;
  title: string;
  content?: string;
  isRead: boolean;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  createdAt: string;
  readAt?: string;
}

interface NotificationPreference {
  enableWebPush: boolean;
  enableEmail: boolean;
  enableSystem: boolean;
  enableExam: boolean;
  enableGrade: boolean;
  enableAlert: boolean;
  enableAudit: boolean;
  emailFrequency: string;
}

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { user } = useAuthStore();

  // Socket连接
  const socketRef = useRef<Socket | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreference | null>(null);

  // ✅ 加载通知列表
  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const res = await api.get('/notifications?pageSize=10');
      setNotifications(res.data.data || []);
      setUnreadCount(res.data.unreadCount || 0);
    } catch (err) {
      console.error('加载通知失败:', err);
    } finally {
      setLoading(false);
    }
  };

  // ✅ 初始化WebSocket连接
  useEffect(() => {
    if (!user?.id) return;

    // 连接Socket.IO服务器
    const socket = io(getSocketURL(), {
      transports: ['websocket'],
      reconnection: true,
    });

    socket.on('connect', () => {
      console.log('[WebSocket] 已连接到通知服务');

      // 发送用户认证
      socket.emit('auth:user', user.id);
    });

    // 接收新通知
    socket.on('notification:new', (data: NotificationItem) => {
      setNotifications(prev => [data, ...prev]);
      setUnreadCount(prev => prev + 1);
      message.info(`新通知: ${data.title}`);
    });

    // 接收未读计数更新
    socket.on('notification:unread_count', (count: number) => {
      setUnreadCount(count);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  // ✅ 打开下拉框时加载数据
  const handleOpenChange = (open: boolean) => {
    setOpen(open);
    if (open) {
      fetchNotifications();
      fetchPreferences();
    }
  };

  // ✅ 标记单条已读
  const handleMarkRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      message.error('操作失败');
    }
  };

  // ✅ 全部标记已读
  const handleMarkAllRead = async () => {
    try {
      await api.put('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
      message.success('已全部标记为已读');
    } catch (err) {
      message.error('操作失败');
    }
  };

  // ✅ 获取偏好设置
  const fetchPreferences = async () => {
    try {
      const res = await api.get('/notifications/preferences');
      setPreferences(res.data.data);
    } catch (err) {
      console.error('加载偏好设置失败:', err);
    }
  };

  // ✅ 更新偏好设置
  const handleUpdatePreference = async (field: string, value: any) => {
    try {
      const res = await api.put('/notifications/preferences', { [field]: value });
      setPreferences(res.data.data);
      message.success('设置已更新');
    } catch (err) {
      message.error('更新失败');
    }
  };

  // ✅ 点击通知项
  const handleClick = (item: NotificationItem) => {
    if (!item.isRead) {
      handleMarkRead(item.id);
    }

    if (item.actionUrl) {
      window.location.href = item.actionUrl;
    }

    setOpen(false); // 关闭下拉框
  };

  // ✅ 下拉菜单内容
  const notificationContent = (
    <div style={{
      width: 380, maxHeight: 500, background: '#fff',
      borderRadius: 14,
      border: '0.5px solid #e5e5ea',
      boxShadow: '0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
    }}>
      {/* 头部工具栏 */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <Text strong>消息通知</Text>
        <Space size="middle">
          {unreadCount > 0 && (
            <Button
              type="link"
              size="small"
              icon={<CheckSquareOutlined />}
              onClick={handleMarkAllRead}
            >
              全部已读
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<SettingOutlined />}
            onClick={() => setSettingsOpen(true)}
          >
            设置
          </Button>
        </Space>
      </div>

      {/* 通知列表 */}
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : notifications.length === 0 ? (
          <Empty description="暂无通知" style={{ padding: 40 }} />
        ) : (
          <List
            dataSource={notifications}
            renderItem={(item) => (
              <List.Item
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  background: item.isRead ? 'transparent' : '#f6ffed',
                  transition: 'background 0.3s',
                }}
                onClick={() => handleClick(item)}
                className={!item.isRead ? 'notification-unread' : ''}
                actions={[
                  !item.isRead && (
                    <Tooltip key="read" title="标记已读">
                      <Button
                        type="text"
                        size="small"
                        icon={<CheckOutlined />}
                        onClick={(e) => { e.stopPropagation(); handleMarkRead(item.id); }}
                      />
                    </Tooltip>
                  ),
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar
                      style={{ backgroundColor: TYPE_CONFIG[item.type]?.color }}
                      icon={TYPE_CONFIG[item.type]?.icon}
                      size="small"
                    />
                  }
                  title={
                    <Space size={4}>
                      <Text strong={!item.isRead} style={{ fontSize: 13 }}>
                        {item.title}
                      </Text>
                      {PRIORITY_CONFIG[item.priority]?.label !== '普通' && (
                        <Tag
                          color={PRIORITY_CONFIG[item.priority]?.color}
                          style={{ fontSize: 10, marginLeft: 4 }}
                        >
                          {PRIORITY_CONFIG[item.priority]?.label}
                        </Tag>
                      )}
                    </Space>
                  }
                  description={
                    <div>
                      {item.content && (
                        <Paragraph
                          ellipsis={{ rows: 1 }}
                          style={{ marginBottom: 4, fontSize: 12, color: '#666' }}
                        >
                          {item.content}
                        </Paragraph>
                      )}
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {dayjs(item.createdAt).fromNow()}
                      </Text>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </div>

      {/* 底部查看更多 */}
      {notifications.length > 0 && (
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid #f0f0f0',
          textAlign: 'center',
        }}>
          <Button type="link" size="small">
            查看全部通知
          </Button>
        </div>
      )}
    </div>
  );

  // ✅ 设置面板内容
  const settingsContent = (
    <Modal
      title="通知偏好设置"
      open={settingsOpen}
      onCancel={() => setSettingsOpen(false)}
      footer={null}
      width={420}
    >
      {preferences && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ fontSize: 13, color: '#888' }}>推送渠道</Text>
            <div style={{ display: 'flex', gap: 32, marginTop: 8 }}>
              <Space>
                <Switch
                  size="small"
                  checked={preferences.enableWebPush}
                  onChange={(val) => handleUpdatePreference('enableWebPush', val)}
                />
                <Text>站内通知</Text>
              </Space>
              <Space>
                <Switch
                  size="small"
                  checked={preferences.enableEmail}
                  onChange={(val) => handleUpdatePreference('enableEmail', val)}
                />
                <Text>邮件通知</Text>
              </Space>
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 13, color: '#888' }}>通知类型</Text>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
            {[
              { key: 'enableSystem', label: '系统公告' },
              { key: 'enableExam', label: '考试通知' },
              { key: 'enableGrade', label: '成绩发布' },
              { key: 'enableAlert', label: '告警提醒' },
              { key: 'enableAudit', label: '审计通知' },
            ].map(({ key, label }) => (
              <Space key={key} style={{ padding: '4px 0' }}>
                <Switch
                  size="small"
                  checked={(preferences as any)[key]}
                  onChange={(val) => handleUpdatePreference(key, val)}
                />
                <Text>{label}</Text>
              </Space>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );

  return (
    <>
      <Dropdown
        dropdownRender={() => notificationContent}
        trigger={['click']}
        open={open}
        onOpenChange={handleOpenChange}
        placement="bottomRight"
        destroyOnHidden
      >
        <BellOutlined
            style={{ fontSize: 18, cursor: 'pointer', padding: '0 8px' }}
          />
      </Dropdown>

      {settingsContent}
    </>
  );
}
