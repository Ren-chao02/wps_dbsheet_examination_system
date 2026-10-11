/**
 * 抽题规则行编辑器（组卷页内联的规则条）
 *
 * 借鉴参考产品「组卷方案」的抽题规则表：题型 + 抽题范围 + 每题分值 +
 * 简单/中等/困难题抽题数量（带 /可用数）+ 总抽题数。
 *
 * 可用数来自 /papers/slot-preview 的 difficultyCounts（600ms 防抖，条件变化取消旧请求）：
 * 教师填数量时能立刻看到"这个难度库里有几道"，不用保存后才发现抽不满。
 */
import { useEffect, useState } from 'react';
import { Select, Button, InputNumber, Popover, Input, Checkbox, Tag, Tooltip, Space, Spin } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import type { Capability, Difficulty } from '../../../types';
import { QUESTION_TYPE_LABELS } from '../../../utils/questionLabels';
import { DIFFICULTY_LABELS, ruleItemTotal, type RuleEditorItem } from '../../../utils/paperAssembly';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

const TYPE_OPTIONS = Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }));

interface RuleItemEditorProps {
  item: RuleEditorItem;
  index: number;
  capabilities: Capability[];
  onPatch: (key: string, patch: Partial<RuleEditorItem>) => void;
  onRemove: (key: string) => void;
  onMove: (key: string, dir: -1 | 1) => void;
}

export function RuleItemEditor({ item, index, capabilities, onPatch, onRemove, onMove }: RuleItemEditorProps) {
  const [availability, setAvailability] = useState<Record<string, number> | null>(item.availability ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeSearch, setScopeSearch] = useState('');

  const capsKey = (item.capabilityIds ?? []).join(',');

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setFailed(false);
      api.post('/papers/slot-preview', {
        rule: {
          ...(item.ruleType ? { type: item.ruleType } : {}),
          capabilityIds: item.capabilityIds ?? [],
        },
        score: item.score,
      }, { signal: controller.signal })
        .then(res => {
          const counts = res.data?.difficultyCounts ?? null;
          setAvailability(counts);
          onPatch(item.key, { availability: counts });
          setLoading(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setFailed(true);
            setLoading(false);
          }
        });
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
    // 只在抽题条件变化时重新查询；onPatch 每次渲染都是新引用，不能进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.key, item.ruleType, item.score, capsKey]);

  const selectedCaps = item.capabilityIds ?? [];
  const filteredCaps = capabilities.filter(c =>
    c.name.toLowerCase().includes(scopeSearch.trim().toLowerCase()));

  const toggleCap = (id: string, checked: boolean) => {
    const next = checked
      ? [...selectedCaps, id]
      : selectedCaps.filter(c => c !== id);
    onPatch(item.key, { capabilityIds: next });
  };

  const countInput = (d: Difficulty) => {
    const want = item.counts[d] || 0;
    const have = availability?.[d];
    const over = availability != null && want > (have ?? 0);
    return (
      <Space size={2}>
        <InputNumber
          size="small"
          min={0}
          max={99}
          value={want}
          status={over ? 'error' : undefined}
          onChange={v => onPatch(item.key, { counts: { ...item.counts, [d]: Number(v) || 0 } })}
          style={{ width: 64 }}
        />
        <span className={`rule-avail${over ? ' rule-avail--over' : ''}`}>
          / {availability ? (have ?? 0) : '—'}
        </span>
      </Space>
    );
  };

  return (
    <div className="rule-strip">
      <div className="rule-strip__idx">{index + 1}</div>

      <div className="rule-field">
        <label>题型</label>
        <Select
          size="small"
          placeholder="请选择题型"
          value={item.ruleType}
          options={TYPE_OPTIONS}
          onChange={v => onPatch(item.key, { ruleType: v })}
          style={{ width: 130 }}
        />
      </div>

      <div className="rule-field">
        <label>抽题范围</label>
        <Popover
          open={scopeOpen}
          onOpenChange={setScopeOpen}
          trigger="click"
          placement="bottomLeft"
          content={
            <div style={{ width: 300 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
                不勾选 = 全部知识点；勾选多个 = 抽出的题必须同时覆盖这些知识点
              </div>
              <Input
                size="small"
                placeholder="搜索知识点"
                prefix={<SearchOutlined />}
                allowClear
                value={scopeSearch}
                onChange={e => setScopeSearch(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <div style={{ maxHeight: 240, overflow: 'auto' }}>
                <Checkbox
                  checked={filteredCaps.length > 0 && filteredCaps.every(c => selectedCaps.includes(c.id))}
                  indeterminate={filteredCaps.some(c => selectedCaps.includes(c.id)) && !filteredCaps.every(c => selectedCaps.includes(c.id))}
                  onChange={e => {
                    if (e.target.checked) {
                      const merged = new Set([...selectedCaps, ...filteredCaps.map(c => c.id)]);
                      onPatch(item.key, { capabilityIds: Array.from(merged) });
                    } else {
                      const toRemove = new Set(filteredCaps.map(c => c.id));
                      onPatch(item.key, { capabilityIds: selectedCaps.filter(c => !toRemove.has(c)) });
                    }
                  }}
                  style={{ marginBottom: 6 }}
                >
                  全选（当前搜索结果）
                </Checkbox>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {filteredCaps.map(c => (
                    <Checkbox
                      key={c.id}
                      checked={selectedCaps.includes(c.id)}
                      onChange={e => toggleCap(c.id, e.target.checked)}
                    >
                      {c.name}
                    </Checkbox>
                  ))}
                  {filteredCaps.length === 0 && <span style={{ color: '#999', fontSize: 12 }}>没有匹配的知识点</span>}
                </div>
              </div>
            </div>
          }
        >
          <Button size="small" style={{ minWidth: 120 }}>
            {selectedCaps.length > 0 ? `已选 ${selectedCaps.length} 个知识点` : '选择范围'}
          </Button>
        </Popover>
      </div>

      <div className="rule-field">
        <label>每题分值</label>
        <InputNumber
          size="small"
          min={1}
          max={1000}
          value={item.score}
          onChange={v => onPatch(item.key, { score: Number(v) || 0 })}
          style={{ width: 72 }}
        />
      </div>

      {DIFFICULTIES.map(d => (
        <div className="rule-field" key={d}>
          <label>{DIFFICULTY_LABELS[d]}题数量</label>
          {countInput(d)}
        </div>
      ))}

      <div className="rule-field">
        <label>总抽题数</label>
        <span className="rule-total">
          {ruleItemTotal(item)}
          {item.noDifficultyCount > 0 && (
            <Tooltip title="历史规则未指定难度，保存后仍按原样抽题；如需按难度抽题请删除本行重新添加">
              <Tag color="orange" style={{ marginLeft: 6 }}>旧规则 {item.noDifficultyCount}</Tag>
            </Tooltip>
          )}
          {loading && <Spin size="small" style={{ marginLeft: 6 }} />}
          {failed && (
            <Tooltip title="可用题数查询失败，保存前请确认题库有足够候选">
              <span style={{ marginLeft: 6, color: '#faad14', fontSize: 12 }}>可用数未知</span>
            </Tooltip>
          )}
        </span>
      </div>

      <div className="rule-strip__ops">
        <Button size="small" type="text" icon={<ArrowUpOutlined />} onClick={() => onMove(item.key, -1)} />
        <Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={() => onMove(item.key, 1)} />
        <Tooltip title="移除本规则">
          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => onRemove(item.key)} />
        </Tooltip>
      </div>
    </div>
  );
}
