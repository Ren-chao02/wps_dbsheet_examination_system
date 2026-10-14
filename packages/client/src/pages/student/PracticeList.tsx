import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Select, InputNumber, Button, Alert, Spin, Typography, Space, Row, Col, Tag, message,
} from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { practiceApi } from '../../services/api';

const { Title, Text } = Typography;

interface CategoryNode {
  id: string; name: string; parentId: string | null; level: number; sortOrder: number;
}

interface Catalog {
  categories: CategoryNode[];
  difficulties: string[];
}

interface StartResponse {
  recordId: string;
  questions: Array<{
    questionId: string; sortOrder: number; title: string; description: string;
    type: string; difficulty: string; score: number; hints: string | null;
  }>;
  maxScore: number;
  shareUrl: string | null;
}

/** 场景实战卡片：只含题数 ≥ 2 的场景（单题场景走自由练习），progress 二选一 */
interface ScenarioSummary {
  key: string;
  name: string;
  questionCount: number;
  totalScore: number;
  running?: { recordId: string; startedAt: string };
  latest?: { recordId: string; score: number; maxScore: number; passed: boolean; submittedAt: string };
}

const difficultyLabels: Record<string, { label: string; color: string }> = {
  easy: { label: '简单', color: 'success' },
  medium: { label: '中等', color: 'warning' },
  hard: { label: '困难', color: 'error' },
};

export function PracticeList() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [hasAssignment, setHasAssignment] = useState<boolean | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);

  const [primaryId, setPrimaryId] = useState<string | undefined>();
  const [secondaryId, setSecondaryId] = useState<string | undefined>();
  const [difficulty, setDifficulty] = useState<string | undefined>();
  const [count, setCount] = useState(5);

  useEffect(() => {
    Promise.all([practiceApi.getAssignment(), practiceApi.getCatalog()])
      .then(([assignment, cat]) => {
        setHasAssignment(!!assignment);
        setCatalog(cat);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, []);

  // 场景列表独立加载：失败静默（整个卡片区不渲染），不能拖垮自由练习入口
  useEffect(() => {
    practiceApi.scenarios()
      .then((res) => setScenarios((res.data?.scenarios || []) as ScenarioSummary[]))
      .catch(() => { /* 静默：无卡片区 */ });
  }, []);

  const primaryCategories = (catalog?.categories || []).filter(c => c.level === 1);
  const secondaryCategories = (catalog?.categories || []).filter(
    c => c.level === 2 && c.parentId === primaryId,
  );

  const handleStart = async () => {
    setStarting(true);
    try {
      const res: StartResponse = await practiceApi.start({
        primaryCategoryId: primaryId,
        secondaryCategoryId: secondaryId,
        difficulty: difficulty as 'easy' | 'medium' | 'hard' | undefined,
        count,
      });
      // 把 questions 和 shareUrl 通过路由 state 传递，避免再次请求
      navigate(`/student/practice/${res.recordId}`, { state: res });
    } catch (err: any) {
      message.error(err.response?.data?.message || '开练失败');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <Title level={3} style={{ marginBottom: 8 }}>
        <ThunderboltOutlined style={{ marginRight: 8, color: '#1890ff' }} />
        题库练习
      </Title>
      <Text type="secondary">按分类与难度随机抽题，在 WPS 多维表格中实操，提交后即时判分并可查看解析。支持无限重试。</Text>

      {hasAssignment === false && (
        <Alert
          type="warning" showIcon
          style={{ marginTop: 16 }}
          message="尚未分配练习表格"
          description="请联系教师为你注册一个 WPS 多维表格作为练习文件，注册后即可开始练习。"
        />
      )}

      {scenarios.length > 0 && (
        <Card title="场景实战（按顺序做完整条任务链）" style={{ marginTop: 16, marginBottom: 16 }}>
          <Row gutter={[12, 12]}>
            {scenarios.map(s => (
              <Col key={s.key} xs={24} sm={12} lg={8}>
                {/* data-scenario 先埋好；「开练」的 onClick 与确认框在 Task 13 接上 */}
                <Card size="small" hoverable data-scenario={s.key}>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: '#888', margin: '4px 0 8px' }}>
                    共 {s.questionCount} 步 · 满分 {s.totalScore}
                  </div>
                  {s.running && <Tag color="processing">进行中，可继续</Tag>}
                  {!s.running && s.latest && (
                    <Tag color={s.latest.passed ? 'success' : 'default'}>
                      已完成 {s.latest.score}/{s.latest.maxScore}
                    </Tag>
                  )}
                  {!s.running && !s.latest && <Tag>未开始</Tag>}
                </Card>
              </Col>
            ))}
          </Row>
        </Card>
      )}

      <Card style={{ marginTop: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12}>
            <div style={{ marginBottom: 6 }}><Text type="secondary">一级分类</Text></div>
            <Select
              style={{ width: '100%' }}
              allowClear placeholder="不限"
              value={primaryId}
              onChange={(v) => { setPrimaryId(v); setSecondaryId(undefined); }}
              options={primaryCategories.map(c => ({ label: c.name, value: c.id }))}
            />
          </Col>
          <Col xs={24} sm={12}>
            <div style={{ marginBottom: 6 }}><Text type="secondary">二级分类</Text></div>
            <Select
              style={{ width: '100%' }}
              allowClear placeholder="不限" disabled={!primaryId}
              value={secondaryId}
              onChange={setSecondaryId}
              options={secondaryCategories.map(c => ({ label: c.name, value: c.id }))}
            />
          </Col>
          <Col xs={24} sm={12}>
            <div style={{ marginBottom: 6 }}><Text type="secondary">难度</Text></div>
            <Select
              style={{ width: '100%' }}
              allowClear placeholder="不限"
              value={difficulty}
              onChange={setDifficulty}
              options={(catalog?.difficulties || []).map(d => ({
                label: difficultyLabels[d]?.label || d,
                value: d,
              }))}
            />
          </Col>
          <Col xs={24} sm={12}>
            <div style={{ marginBottom: 6 }}><Text type="secondary">题量</Text></div>
            <InputNumber
              min={1} max={20} value={count}
              onChange={(v) => setCount(v ?? 5)}
              style={{ width: '100%' }}
            />
          </Col>
        </Row>

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Space direction="vertical" size={8}>
            <Button
              type="primary" size="large" icon={<ThunderboltOutlined />}
              loading={starting} disabled={hasAssignment === false}
              onClick={handleStart}
              style={{ minWidth: 200, height: 48 }}
            >
              开始练习
            </Button>
            {hasAssignment === false && <Text type="secondary" style={{ fontSize: 12 }}>需先注册练习文件</Text>}
          </Space>
        </div>
      </Card>

      <Card title="练习说明" size="small" style={{ marginTop: 16 }}>
        <Space direction="vertical" size={4}>
          <Text>• 每次练习会重置你的专属练习文件，请放心操作。</Text>
          <Text>• 提交后即时判分，可查看每题判分明细与解析。</Text>
          <Text>• 练习无时间/全屏/切屏限制，可随时重试。</Text>
          <Text>• 错题会自动加入错题本。</Text>
        </Space>
      </Card>
    </div>
  );
}
