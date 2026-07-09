/**
 * 规则预览器（出题辅助第③段，替换原 RuleEditor）
 *
 * 展示反向生成的规则建议，支持勾选/编辑分值/编辑参数/删除，
 * 最终将选中的规则应用为题目的 answerRules。
 *
 * @see docs/superpowers/specs/2026-07-07-exam-authoring-assist.md §4.3
 */
import { useState } from 'react';
import {
  Card, Checkbox, Tag, InputNumber, Button, Space, Empty, Typography, Tooltip, message, Row, Col,
} from 'antd';
import { EditOutlined, DeleteOutlined, CheckCircleOutlined, WarningOutlined } from '@ant-design/icons';
import type { AnswerRule, RuleSuggestion } from '../../../types';
import { RuleEditorModal } from './RuleEditorModal';

const { Text } = Typography;

interface RulePreviewerProps {
  suggestions: RuleSuggestion[];
  onChange: (suggestions: RuleSuggestion[]) => void;
  /** 应用选中规则到题目 answerRules */
  onApply: (rules: AnswerRule[]) => void;
}

export function RulePreviewer({ suggestions, onChange, onApply }: RulePreviewerProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const allChecked = suggestions.length > 0 && suggestions.every(s => s.selected);
  const someChecked = suggestions.some(s => s.selected) && !allChecked;
  const selectedCount = suggestions.filter(s => s.selected).length;
  const totalScore = suggestions.filter(s => s.selected).reduce((sum, s) => sum + s.rule.score, 0);
  const hasEditable = suggestions.some(s => s.editable);

  /** 切换单条勾选 */
  const toggleSelected = (index: number, checked: boolean) => {
    const updated = [...suggestions];
    updated[index] = { ...updated[index], selected: checked };
    onChange(updated);
  };

  /** 全选/取消全选 */
  const toggleAll = (checked: boolean) => {
    onChange(suggestions.map(s => ({ ...s, selected: checked })));
  };

  /** 修改分值 */
  const updateScore = (index: number, score: number) => {
    const updated = [...suggestions];
    updated[index] = {
      ...updated[index],
      rule: { ...updated[index].rule, score: score ?? 0 },
    };
    onChange(updated);
  };

  /** 删除一条建议 */
  const removeSuggestion = (index: number) => {
    onChange(suggestions.filter((_, i) => i !== index));
  };

  /** 保存编辑（来自 RuleEditorModal） */
  const handleSaveEdit = (rule: AnswerRule) => {
    if (editingIndex === null) return;
    const updated = [...suggestions];
    updated[editingIndex] = {
      ...updated[editingIndex],
      rule,
      // 补全参数后，标记为可选中
      editable: false,
      selected: true,
      missingParams: [],
    };
    onChange(updated);
    setEditingIndex(null);
    message.success('规则已更新');
  };

  /** 应用选中规则到题目 */
  const handleApply = () => {
    const rules = suggestions.filter(s => s.selected).map(s => s.rule);
    if (rules.length === 0) {
      message.warning('请至少勾选一条规则');
      return;
    }
    onApply(rules);
    message.success(`已应用 ${rules.length} 条规则到题目（总分 ${rules.reduce((sum, r) => sum + r.score, 0)} 分）`);
  };

  /** params 单行摘要 */
  const summarizeParams = (params: Record<string, any>): string => {
    const entries = Object.entries(params);
    if (entries.length === 0) return '{}';
    return entries.map(([k, v]) => {
      const val = typeof v === 'string' ? `"${v.length > 16 ? v.slice(0, 16) + '…' : v}"` : JSON.stringify(v);
      return `${k}:${val}`;
    }).join(' ');
  };

  return (
    <Card
      title={
        <Space>
          <span>③ 预览与确认规则</span>
          <Tag color="blue">{selectedCount}/{suggestions.length} 选中</Tag>
          {hasEditable && (
            <Tooltip title="含缺参数规则，请点击编辑补全后再勾选">
              <Tag color="orange" icon={<WarningOutlined />}>需补全</Tag>
            </Tooltip>
          )}
        </Space>
      }
      extra={
        <Space>
          <Checkbox
            indeterminate={someChecked}
            checked={allChecked}
            onChange={e => toggleAll(e.target.checked)}
            disabled={suggestions.length === 0}
          >
            全选
          </Checkbox>
          <Button
            type="primary"
            icon={<CheckCircleOutlined />}
            onClick={handleApply}
            disabled={selectedCount === 0}
          >
            应用选中规则到题目
          </Button>
        </Space>
      }
      style={{ marginBottom: 16 }}
    >
      {suggestions.length === 0 ? (
        <Empty description="尚未生成规则建议，请先在第②段导入标准答案" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <>
          <div style={{ maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
            {suggestions.map((s, index) => (
              <div
                key={s.rule.id}
                style={{
                  padding: '10px 12px',
                  marginBottom: 8,
                  border: `1px solid ${s.editable ? '#faad14' : s.selected ? '#1677ff' : '#f0f0f0'}`,
                  borderRadius: 6,
                  background: s.editable ? '#fffbe6' : s.selected ? '#e6f4ff' : '#fafafa',
                }}
              >
                <Row align="middle" gutter={8}>
                  <Col flex="auto">
                    <Checkbox
                      checked={s.selected}
                      onChange={e => toggleSelected(index, e.target.checked)}
                      disabled={s.editable}
                    >
                      <Space size={6}>
                        <Tag color="blue">{s.rule.action}</Tag>
                        <Text style={{ fontSize: 13 }}>
                          表「{s.source.sheetName}」
                          {s.source.fieldName ? ` · ${s.source.fieldName}` : ''}
                        </Text>
                        {s.editable && (
                          <Tooltip title={`缺参数：${s.missingParams.join(', ')}`}>
                            <Tag color="orange" icon={<WarningOutlined />}>需补全</Tag>
                          </Tooltip>
                        )}
                      </Space>
                    </Checkbox>
                    <div style={{ marginTop: 4, marginLeft: 24 }}>
                      <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {summarizeParams(s.rule.params)}
                      </Text>
                    </div>
                  </Col>
                  <Col flex="160px" style={{ textAlign: 'right' }}>
                    <Space size={4}>
                      <InputNumber
                        value={s.rule.score}
                        onChange={v => updateScore(index, v ?? 0)}
                        min={0}
                        max={100}
                        addonAfter="分"
                        size="small"
                        style={{ width: 110 }}
                      />
                      <Tooltip title="编辑规则">
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => setEditingIndex(index)}
                        />
                      </Tooltip>
                      <Tooltip title="删除">
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => removeSuggestion(index)}
                        />
                      </Tooltip>
                    </Space>
                  </Col>
                </Row>
              </div>
            ))}
          </div>

          {/* 分值汇总 */}
          <Row justify="end" style={{ marginTop: 12 }}>
            <Space size="large">
              <Text>已选规则：<Text strong>{selectedCount}</Text> 条</Text>
              <Tag color="blue" style={{ fontSize: 14, padding: '4px 12px' }}>
                总分：{totalScore} 分
              </Tag>
            </Space>
          </Row>
        </>
      )}

      <RuleEditorModal
        visible={editingIndex !== null}
        suggestion={editingIndex !== null ? suggestions[editingIndex] : null}
        onSave={handleSaveEdit}
        onCancel={() => setEditingIndex(null)}
      />
    </Card>
  );
}
