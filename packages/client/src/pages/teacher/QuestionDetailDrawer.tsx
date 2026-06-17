import React from 'react';
import { Drawer, Descriptions, Tag, Divider, Typography, Space } from 'antd';
import { Question } from '../../types';

const { Paragraph, Text } = Typography;

interface QuestionDetailDrawerProps {
  visible: boolean;
  question: Question | null;
  onClose: () => void;
}

// 难度映射
const difficultyConfig: Record<string, { label: string; color: string }> = {
  easy: { label: '简单', color: 'green' },
  medium: { label: '中等', color: 'orange' },
  hard: { label: '困难', color: 'red' },
};

// 状态映射
const statusConfig: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  published: { label: '已发布', color: 'green' },
  archived: { label: '已归档', color: 'gray' },
};

export const QuestionDetailDrawer: React.FC<QuestionDetailDrawerProps> = ({
  visible,
  question,
  onClose,
}) => {
  if (!question) return null;

  return (
    <Drawer
      title="题目详情"
      placement="right"
      width={720}
      onClose={onClose}
      open={visible}
    >
      {/* 基本信息区域 */}
      <Descriptions title="基本信息" bordered column={1} size="small">
        <Descriptions.Item label="题目标题">
          <Text strong style={{ fontSize: 16 }}>
            {question.title}
          </Text>
        </Descriptions.Item>

        <Descriptions.Item label="难度等级">
          <Tag color={difficultyConfig[question.difficulty]?.color || 'default'}>
            {difficultyConfig[question.difficulty]?.label || question.difficulty}
          </Tag>
        </Descriptions.Item>

        <Descriptions.Item label="分值">
          <Text strong>{question.score} 分</Text>
        </Descriptions.Item>

        <Descriptions.Item label="状态">
          <Tag color={statusConfig[question.status]?.color || 'default'}>
            {statusConfig[question.status]?.label || question.status}
          </Tag>
        </Descriptions.Item>
      </Descriptions>

      {/* 知识点分类区域 */}
      <Divider orientation="left">知识点分类</Divider>
      <Descriptions bordered column={2} size="small">
        <Descriptions.Item label="一级分类" span={1}>
          {question.primaryCategory ? (
            <Tag color="blue">{question.primaryCategory.name}</Tag>
          ) : (
            <Text type="secondary">未设置</Text>
          )}
        </Descriptions.Item>

        <Descriptions.Item label="二级分类" span={1}>
          {question.secondaryCategory ? (
            <Tag color="cyan">{question.secondaryCategory.name}</Tag>
          ) : (
            <Text type="secondary">未设置</Text>
          )}
        </Descriptions.Item>
      </Descriptions>

      {/* 元数据信息区域 */}
      <Divider orientation="left">元数据信息</Divider>
      <Descriptions bordered column={2} size="small">
        <Descriptions.Item label="出题老师" span={1}>
          {question.teacherName || (
            <Text type="secondary">未设置</Text>
          )}
        </Descriptions.Item>

        <Descriptions.Item label="更新人" span={1}>
          {question.updatedBy || (
            <Text type="secondary">暂无更新记录</Text>
          )}
        </Descriptions.Item>

        <Descriptions.Item label="创建时间" span={1}>
          {new Date(question.createdAt).toLocaleString('zh-CN')}
        </Descriptions.Item>

        <Descriptions.Item label="更新时间" span={1}>
          {new Date(question.updatedAt).toLocaleString('zh-CN')}
        </Descriptions.Item>

        <Descriptions.Item label="创建者" span={2}>
          {question.creator?.realName || '系统'}
        </Descriptions.Item>
      </Descriptions>

      {/* 题目内容区域 */}
      {question.description && (
        <>
          <Divider orientation="left">题目内容</Divider>
          <div
            style={{
              background: '#fafafa',
              padding: '16px',
              borderRadius: '8px',
              marginBottom: '16px',
            }}
          >
            <Paragraph>{question.description}</Paragraph>
          </div>
        </>
      )}

      {/* 提示信息 */}
      {question.hints && (
        <>
          <Divider orientation="left">操作提示</Divider>
          <div
            style={{
              background: '#e6f7ff',
              border: '1px solid #91d5ff',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px',
            }}
          >
            <Text type="secondary">{question.hints}</Text>
          </div>
        </>
      )}

      {/* 标签区域 */}
      {question.tags && question.tags.length > 0 && (
        <>
          <Divider orientation="left">标签</Divider>
          <Space wrap>
            {question.tags.map((tag, index) => (
              <Tag key={index} color="geekblue">
                {tag}
              </Tag>
            ))}
          </Space>
        </>
      )}

      {/* 评分规则区域 */}
      {question.answerRules && question.answerRules.length > 0 && (
        <>
          <Divider orientation="left">评分规则</Divider>
          <div
            style={{
              background: '#f6ffed',
              border: '1px solid #b7eb8f',
              borderRadius: '8px',
              padding: '16px',
            }}
          >
            {question.answerRules.map((rule, index) => (
              <div key={rule.id} style={{ marginBottom: index < question.answerRules.length - 1 ? 12 : 0 }}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Text strong>
                    步骤 {index + 1}: {rule.action}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    检查标准: {JSON.stringify(rule.params)}
                  </Text>
                  <Text style={{ fontSize: 13, color: '#52c41a' }}>
                    得分: {rule.score} 分{rule.score > 0 ? '' : ' (可选步骤)'}
                  </Text>
                </Space>
                {index < question.answerRules.length - 1 && (
                  <Divider style={{ margin: '12px 0' }} />
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Drawer>
  );
};
