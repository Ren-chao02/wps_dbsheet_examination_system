/**
 * ProposalCard — Phase 2 §5.1 建议卡（类型化渲染）
 *
 * 6 种 Proposal 类型各有不同的标题与摘要渲染。
 * 卡片状态：pending（待操作）/ applied（已应用，置灰）/ dismissed（已忽略，移除）。
 *
 * @see docs/superpowers/specs/2026-07-08-phase2-ai-coaching-design.md §5.1
 */
import { Card, Tag, Button, Space, Typography } from 'antd';
import {
  PlusCircleOutlined, EditOutlined, SwapOutlined, DeleteOutlined,
  BulbOutlined, ThunderboltOutlined, CheckOutlined,
} from '@ant-design/icons';
import type { Proposal } from '../../../types';

const { Text, Paragraph } = Typography;

export type ProposalStatus = 'pending' | 'applied' | 'dismissed';

interface ProposalCardProps {
  proposal: Proposal;
  status: ProposalStatus;
  onApply: () => void;
  onDismiss: () => void;
}

/** 类型化标题与图标 */
function renderHeader(p: Proposal): { icon: React.ReactNode; title: string } {
  switch (p.type) {
    case 'add_capability':
      return { icon: <PlusCircleOutlined />, title: `添加能力：${p.capabilityId}` };
    case 'rewrite_description':
      return { icon: <EditOutlined />, title: '修改题目描述' };
    case 'adjust_score':
      return { icon: <SwapOutlined />, title: `调整分值：${p.ruleId} → ${p.newScore} 分` };
    case 'remove_rule':
      return { icon: <DeleteOutlined />, title: `移除规则：${p.ruleId}` };
    case 'add_hint':
      return { icon: <BulbOutlined />, title: '添加提示' };
    case 'add_rule':
      return {
        icon: <ThunderboltOutlined />,
        title: `添加规则：${p.action}${p.fieldName ? ` · ${p.tableName}.${p.fieldName}` : ` · ${p.tableName}`}`,
      };
  }
}

/** 类型化摘要 */
function renderSummary(p: Proposal): React.ReactNode {
  switch (p.type) {
    case 'add_capability':
      return null;
    case 'rewrite_description':
      return (
        <Paragraph style={{ margin: 0, color: '#666' }}>
          新描述：{p.newDescription}
        </Paragraph>
      );
    case 'adjust_score':
      return null;
    case 'remove_rule':
      return null;
    case 'add_hint':
      return (
        <Paragraph style={{ margin: 0, color: '#666' }}>
          提示：{p.hint}
        </Paragraph>
      );
    case 'add_rule':
      return p.groundedRule ? (
        <Tag color="blue" style={{ marginTop: 4 }}>
          {p.groundedRule.action} · 已从标准答案解析参数
        </Tag>
      ) : null;
  }
}

export function ProposalCard({ proposal, status, onApply, onDismiss }: ProposalCardProps) {
  const { icon, title } = renderHeader(proposal);
  const isApplied = status === 'applied';
  const isDismissed = status === 'dismissed';

  if (isDismissed) return null;

  return (
    <Card
      size="small"
      style={{
        marginBottom: 8,
        opacity: isApplied ? 0.55 : 1,
        borderLeft: `3px solid ${isApplied ? '#52c41a' : '#1677ff'}`,
      }}
    >
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Space>
          {icon}
          <Text strong>{title}</Text>
          {isApplied && <Tag icon={<CheckOutlined />} color="success">已应用</Tag>}
        </Space>
        {renderSummary(proposal)}
        {proposal.reason && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {proposal.reason}
          </Text>
        )}
        {!isApplied && (
          <Space style={{ marginTop: 4 }}>
            <Button type="primary" size="small" onClick={onApply}>
              应用
            </Button>
            <Button size="small" onClick={onDismiss}>
              忽略
            </Button>
          </Space>
        )}
      </Space>
    </Card>
  );
}
