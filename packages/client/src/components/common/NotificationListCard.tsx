/**
 * NotificationListCard —— 工作台 / 学生首页的「通知公告」卡片。
 *
 * 从 /notifications 拉最近若干条，带类型标签（考试通知/成绩发布/…）与相对时间；
 * 未读条目在标题前有蓝点；通知带 actionUrl 时整行可点击跳转。
 * 顶部铃铛（NotificationCenter 下拉）负责交互式管理，这里只做首页聚合展示，
 * 因此不入未读计数、不提供已读操作。
 */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Card, Spin, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import api from '../../services/api';
import { EmptyState } from './EmptyState';

dayjs.extend(relativeTime);

const { Text } = Typography;

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  content?: string;
  isRead: boolean;
  actionUrl?: string;
  createdAt: string;
}

/** 类型标签（与 NotificationCenter 的 TYPE_CONFIG 保持一致的叫法；此处只要标签与颜色） */
const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  SYSTEM: { label: '系统公告', color: '#1890ff' },
  EXAM: { label: '考试通知', color: '#1677ff' },
  GRADE: { label: '成绩发布', color: '#52c41a' },
  ALERT: { label: '告警提醒', color: '#ff4d4f' },
  AUDIT: { label: '审计通知', color: '#faad14' },
};

interface NotificationListCardProps {
  title?: string;
  pageSize?: number;
  style?: CSSProperties;
}

export function NotificationListCard({ title = '通知公告', pageSize = 6, style }: NotificationListCardProps) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/notifications?pageSize=${pageSize}`)
      .then((res) => {
        if (!cancelled) setItems(res.data?.data || []);
      })
      .catch(() => {
        // 通知拉取失败不打断首页：静默为空列表
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pageSize]);

  const handleClick = (item: NotificationItem) => {
    // actionUrl 只接受站内相对路径，避免跳转外部地址
    if (item.actionUrl && item.actionUrl.startsWith('/')) navigate(item.actionUrl);
  };

  return (
    <Card title={title} style={style} styles={{ body: { padding: items.length === 0 && !loading ? '8px 20px 20px' : '4px 12px 8px' } }}>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="暂无通知" style={{ padding: '20px 0 12px' }} />
      ) : (
        <div>
          {items.map((item) => {
            const cfg = TYPE_CONFIG[item.type] || { label: item.type, color: '#8c8c8c' };
            const clickable = Boolean(item.actionUrl && item.actionUrl.startsWith('/'));
            return (
              <div
                key={item.id}
                className={`notice-item${clickable ? ' notice-item--clickable' : ''}`}
                onClick={() => handleClick(item)}
              >
                <div className="notice-item__head">
                  {!item.isRead && <span className="notice-item__dot" />}
                  <Tag color={cfg.color} style={{ margin: 0, flexShrink: 0 }}>
                    {cfg.label}
                  </Tag>
                  <span className="notice-item__title" title={item.title}>
                    {item.title}
                  </span>
                </div>
                <div className="notice-item__meta">
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(item.createdAt).fromNow()}
                  </Text>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
