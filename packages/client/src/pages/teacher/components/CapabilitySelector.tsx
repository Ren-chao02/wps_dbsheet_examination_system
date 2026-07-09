/**
 * 能力选择器（出题辅助第①段）
 *
 * 左侧域导航 + 右侧能力清单 + 搜索 + 已选计数。
 * 出题人勾选能力后，系统据此生成题目骨架、反向生成规则。
 *
 * @see docs/superpowers/specs/2026-07-07-exam-authoring-assist.md §4.3
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Card, Row, Col, Input, Checkbox, Tag, Empty, Spin, message, Tooltip, Button, Space, Collapse, Typography,
} from 'antd';
import { SearchOutlined, InfoCircleOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import type {
  Capability, CapabilityDomain, CapabilityDomainInfo, CapabilityGraphResponse, Scorable,
} from '../../../types';

const { Text } = Typography;

/** scorable 标签配色 */
const SCORABLE_TAG: Record<Scorable, { color: string; label: string }> = {
  auto: { color: 'green', label: '自动判分' },
  manual: { color: 'default', label: '人工判分' },
  needsReview: { color: 'orange', label: '自动+复核' },
};

interface CapabilitySelectorProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function CapabilitySelector({ selectedIds, onChange }: CapabilitySelectorProps) {
  const [domains, setDomains] = useState<CapabilityDomainInfo[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDomain, setActiveDomain] = useState<CapabilityDomain | 'all'>('all');
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    api
      .get<CapabilityGraphResponse>('/capabilities')
      .then(res => {
        const data = res.data?.data;
        if (data) {
          setDomains(data.domains);
          setCapabilities(data.capabilities);
        }
      })
      .catch(() => message.error('能力图谱加载失败'))
      .finally(() => setLoading(false));
  }, []);

  /** 按当前域 + 关键词过滤 */
  const filteredCapabilities = useMemo(() => {
    let list = capabilities;
    if (activeDomain !== 'all') {
      list = list.filter(c => c.domain === activeDomain);
    }
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter(
        c =>
          c.name.toLowerCase().includes(kw) ||
          c.id.toLowerCase().includes(kw) ||
          c.description.toLowerCase().includes(kw),
      );
    }
    return list;
  }, [capabilities, activeDomain, keyword]);

  const allChecked = filteredCapabilities.length > 0 && filteredCapabilities.every(c => selectedIds.includes(c.id));
  const someChecked = filteredCapabilities.some(c => selectedIds.includes(c.id)) && !allChecked;

  /** 切换单个能力 */
  const toggleCapability = (capId: string, checked: boolean) => {
    if (checked) {
      onChange([...selectedIds, capId]);
    } else {
      onChange(selectedIds.filter(id => id !== capId));
    }
  };

  /** 全选/取消当前过滤结果 */
  const toggleAll = (checked: boolean) => {
    const filteredIds = filteredCapabilities.map(c => c.id);
    if (checked) {
      const merged = Array.from(new Set([...selectedIds, ...filteredIds]));
      onChange(merged);
    } else {
      onChange(selectedIds.filter(id => !filteredIds.includes(id)));
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin tip="加载能力图谱…" /></div>;
  }

  return (
    <Card
      title={
        <Space>
          <span>① 选择考察能力</span>
          <Tag color="blue">{selectedIds.length} 项已选</Tag>
        </Space>
      }
      extra={
        <Button type="link" onClick={() => onChange([])} disabled={selectedIds.length === 0}>
          清空已选
        </Button>
      }
      style={{ marginBottom: 16 }}
    >
      <Row gutter={16}>
        {/* 左侧：域导航 */}
        <Col xs={24} sm={7} md={6}>
          <div style={{ marginBottom: 8 }}>
            <Text type="secondary">能力域</Text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <DomainButton
              label="全部"
              count={capabilities.length}
              active={activeDomain === 'all'}
              onClick={() => setActiveDomain('all')}
            />
            {domains.map(d => (
              <DomainButton
                key={d.id}
                label={d.label}
                count={d.count}
                active={activeDomain === d.id}
                onClick={() => setActiveDomain(d.id)}
              />
            ))}
          </div>
        </Col>

        {/* 右侧：能力清单 */}
        <Col xs={24} sm={17} md={18}>
          <Row justify="space-between" align="middle" style={{ marginBottom: 8 }}>
            <Col>
              <Checkbox
                indeterminate={someChecked}
                checked={allChecked}
                onChange={e => toggleAll(e.target.checked)}
                disabled={filteredCapabilities.length === 0}
              >
                全选当前列表
              </Checkbox>
            </Col>
            <Col flex="300px">
              <Input
                allowClear
                placeholder="搜索能力名称/描述"
                prefix={<SearchOutlined />}
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
              />
            </Col>
          </Row>

          {filteredCapabilities.length === 0 ? (
            <Empty description="无匹配能力" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
              {filteredCapabilities.map(cap => {
                const checked = selectedIds.includes(cap.id);
                const tag = SCORABLE_TAG[cap.scorable];
                return (
                  <div
                    key={cap.id}
                    style={{
                      padding: '8px 12px',
                      marginBottom: 6,
                      border: `1px solid ${checked ? '#1677ff' : '#f0f0f0'}`,
                      borderRadius: 6,
                      background: checked ? '#e6f4ff' : '#fafafa',
                      transition: 'all 0.2s',
                    }}
                  >
                    <Checkbox checked={checked} onChange={e => toggleCapability(cap.id, e.target.checked)}>
                      <Space size={4}>
                        <Text strong>{cap.name}</Text>
                        <Tag color={tag.color} style={{ marginLeft: 4 }}>{tag.label}</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>{cap.defaultDifficulty}</Text>
                        <Tooltip title={cap.description}>
                          <InfoCircleOutlined style={{ color: '#999', fontSize: 12 }} />
                        </Tooltip>
                      </Space>
                    </Checkbox>
                    <Collapse
                      ghost
                      size="small"
                      style={{ marginTop: 4 }}
                      items={[{
                        key: cap.id,
                        label: <Text type="secondary" style={{ fontSize: 12 }}>考法（{cap.examPatterns.length}）</Text>,
                        children: (
                          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#666' }}>
                            {cap.examPatterns.map((p, i) => (
                              <li key={i}>
                                <Text style={{ fontSize: 12 }}>{p.title}</Text>
                                {p.ruleTemplate ? (
                                  <Tag style={{ fontSize: 11, marginLeft: 6 }}>{p.ruleTemplate.action}</Tag>
                                ) : (
                                  <Tag color="default" style={{ fontSize: 11, marginLeft: 6 }}>人工</Tag>
                                )}
                              </li>
                            ))}
                          </ul>
                        ),
                      }]}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </Col>
      </Row>
    </Card>
  );
}

/** 域按钮 */
function DomainButton({ label, count, active, onClick }: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '8px 12px',
        borderRadius: 6,
        border: `1px solid ${active ? '#1677ff' : '#f0f0f0'}`,
        background: active ? '#1677ff' : '#fff',
        color: active ? '#fff' : '#333',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        transition: 'all 0.2s',
      }}
    >
      <span>{label}</span>
      <span style={{ opacity: 0.7, fontSize: 12 }}>{count}</span>
    </button>
  );
}
