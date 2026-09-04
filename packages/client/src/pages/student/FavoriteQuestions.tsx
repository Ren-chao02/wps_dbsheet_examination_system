import { useEffect, useMemo, useState } from 'react';
import type { Key } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Table, Tag, Button, Empty, Typography, message, Select, Input, Space, Tabs,
  Modal, Popconfirm, Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  StarOutlined, ThunderboltOutlined, EyeOutlined, DeleteOutlined, FolderOpenOutlined,
} from '@ant-design/icons';
import { practiceApi } from '../../services/api';
import type {
  FavoriteItem, WrongItem, QuestionBrief, StartResponse, QuestionType, Difficulty,
} from '../../types';

const { Title, Text, Paragraph } = Typography;

const difficultyLabels: Record<string, { label: string; color: string }> = {
  easy: { label: '简单', color: 'success' },
  medium: { label: '中等', color: 'warning' },
  hard: { label: '困难', color: 'error' },
};

const typeLabels: Record<string, string> = {
  create_table: '建表',
  add_field: '加字段',
  config_view: '配视图',
  create_form: '建表单',
  comprehensive: '综合',
};

const ALL_TYPES: QuestionType[] = ['create_table', 'add_field', 'config_view', 'create_form', 'comprehensive'];
const ALL_DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

function formatTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** 类型/难度/下线状态 标签组 */
function questionTags(q: QuestionBrief) {
  return (
    <>
      <Tag color={difficultyLabels[q.difficulty]?.color}>
        {difficultyLabels[q.difficulty]?.label || q.difficulty}
      </Tag>
      <Tag>{typeLabels[q.type] || q.type}</Tag>
      {q.status !== 'published' && <Tag color="default">已下线</Tag>}
    </>
  );
}

export function FavoriteQuestions() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'fav' | 'wrong'>('fav');
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [wrong, setWrong] = useState<WrongItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasAssignment, setHasAssignment] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);

  // 筛选：关键词 / 类型 / 难度
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>();
  const [diffFilter, setDiffFilter] = useState<string>();

  // 收藏 Tab 批量选择
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  // 解析弹窗
  const [detailQuestion, setDetailQuestion] = useState<QuestionBrief | null>(null);

  useEffect(() => {
    Promise.all([practiceApi.favorites(), practiceApi.wrongQuestions(), practiceApi.getAssignment()])
      .then(([favList, wrongList, assignment]) => {
        setFavorites(favList);
        setWrong(wrongList);
        setHasAssignment(!!assignment);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, []);

  /** 刷新收藏列表 */
  const refreshFavorites = async () => {
    const list = await practiceApi.favorites();
    setFavorites(list);
  };

  /** 再练一次 / 勾选组卷：按指定题目开一轮练习 */
  const handleRedo = async (questionIds: string[]) => {
    if (!questionIds.length) return;
    setStarting(true);
    try {
      const res: StartResponse = await practiceApi.start({ questionIds });
      navigate(`/student/practice/${res.recordId}`, { state: res });
    } catch (err: any) {
      message.error(err.response?.data?.message || '开练失败，请确认已注册练习表格');
    } finally {
      setStarting(false);
    }
  };

  /** 取消收藏单题 */
  const handleUnfavorite = async (questionId: string) => {
    try {
      await practiceApi.toggleFavorite(questionId); // 已收藏 → 取消
      await refreshFavorites();
      setSelectedRowKeys(keys => keys.filter(k => k !== questionId));
      message.success('已取消收藏');
    } catch {
      message.error('操作失败，请重试');
    }
  };

  /** 从错题 Tab 加入收藏 */
  const handleFavoriteFromWrong = async (questionId: string) => {
    try {
      const res = await practiceApi.toggleFavorite(questionId);
      message.success(res.favorited ? '已加入收藏' : '已取消收藏');
      await refreshFavorites();
    } catch {
      message.error('操作失败，请重试');
    }
  };

  /** 批量取消收藏 */
  const handleBatchUnfavorite = async () => {
    if (!selectedRowKeys.length) return;
    try {
      for (const qid of selectedRowKeys as string[]) {
        await practiceApi.toggleFavorite(qid);
      }
      await refreshFavorites();
      message.success(`已取消收藏 ${selectedRowKeys.length} 道题`);
      setSelectedRowKeys([]);
    } catch {
      message.error('批量操作失败，请重试');
    }
  };

  // ── 筛选（作用于当前 Tab） ──
  const favList = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return favorites.filter(it => {
      const q = it.question;
      if (typeFilter && q.type !== typeFilter) return false;
      if (diffFilter && q.difficulty !== diffFilter) return false;
      if (kw && !q.title.toLowerCase().includes(kw) && !(q.description || '').toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [favorites, keyword, typeFilter, diffFilter]);

  const wrongList = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return wrong.filter(it => {
      const q = it.question;
      if (typeFilter && q.type !== typeFilter) return false;
      if (diffFilter && q.difficulty !== diffFilter) return false;
      if (kw && !q.title.toLowerCase().includes(kw) && !(q.description || '').toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [wrong, keyword, typeFilter, diffFilter]);

  // ── 通用操作列 ──
  const redoAction = (q: QuestionBrief, label = '再练一次') => (
    <Button
      type="link" size="small" icon={<ThunderboltOutlined />}
      disabled={q.status !== 'published'}
      onClick={() => handleRedo([q.id])}
    >
      {label}
    </Button>
  );

  const detailAction = (q: QuestionBrief) => (
    <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setDetailQuestion(q)}>
      解析
    </Button>
  );

  const titleRender = (q: QuestionBrief) => (
    <div>
      <Text strong style={{ fontSize: 13 }}>{q.title}</Text>
      <div style={{ marginTop: 4 }}>{questionTags(q)}</div>
    </div>
  );

  const favColumns: ColumnsType<FavoriteItem> = [
    {
      title: '题目', key: 'title', width: 380,
      render: (_, it) => titleRender(it.question),
    },
    {
      title: '分类', key: 'category', width: 130,
      render: (_, it) => it.question.secondaryCategory?.name || it.question.primaryCategory?.name || '—',
    },
    {
      title: '分值', key: 'score', width: 70,
      render: (_, it) => it.question.score,
    },
    {
      title: '收藏时间', key: 'createdAt', width: 170,
      render: (_, it) => formatTime(it.createdAt),
    },
    {
      title: '操作', key: 'action', width: 190,
      render: (_, it) => {
        const q = it.question;
        return (
          <Space size={0} wrap>
            {redoAction(q)}
            {detailAction(q)}
            <Popconfirm title="取消收藏该题？" onConfirm={() => handleUnfavorite(q.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>取消收藏</Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const wrongColumns: ColumnsType<WrongItem> = [
    {
      title: '题目', key: 'title', width: 380,
      render: (_, it) => titleRender(it.question),
    },
    {
      title: '错题次数', key: 'wrongCount', width: 100,
      render: (_, it) => <Tag color={it.wrongCount >= 3 ? 'error' : 'warning'}>{it.wrongCount} 次</Tag>,
    },
    {
      title: '最近出错', key: 'lastWrongAt', width: 170,
      render: (_, it) => formatTime(it.lastWrongAt),
    },
    {
      title: '分值', key: 'score', width: 70,
      render: (_, it) => it.question.score,
    },
    {
      title: '操作', key: 'action', width: 210,
      render: (_, it) => {
        const q = it.question;
        return (
          <Space size={0} wrap>
            {redoAction(q)}
            {detailAction(q)}
            <Button
              type="link" size="small" icon={<StarOutlined />}
              disabled={q.status !== 'published'}
              onClick={() => handleFavoriteFromWrong(q.id)}
            >
              加入收藏
            </Button>
          </Space>
        );
      },
    },
  ];

  const selectedFavs = favorites.filter(it => selectedRowKeys.includes(it.question.id));
  const selectedCount = selectedFavs.length;

  const filterBar = (
    <Space wrap style={{ marginBottom: 16 }}>
      <Input
        allowClear placeholder="搜索题目标题/描述"
        prefix={<Text type="secondary">🔍</Text>}
        style={{ width: 220 }}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />
      <Select
        allowClear placeholder="题型" style={{ width: 120 }}
        value={typeFilter} onChange={setTypeFilter}
        options={ALL_TYPES.map(t => ({ label: typeLabels[t] || t, value: t }))}
      />
      <Select
        allowClear placeholder="难度" style={{ width: 110 }}
        value={diffFilter} onChange={setDiffFilter}
        options={ALL_DIFFICULTIES.map(d => ({ label: difficultyLabels[d]?.label || d, value: d }))}
      />
    </Space>
  );

  const favEmpty = (
    <Empty
      image={<StarOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />}
      description={
        <Space direction="vertical" size={4}>
          <Text>还没有收藏的题目</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            在练习作答页 / 判分结果页点击 ☆ 星标，即可把想再练的题收进这里
          </Text>
        </Space>
      }
    >
      <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => navigate('/student/practice')}>
        去题库练习
      </Button>
    </Empty>
  );

  const wrongEmpty = (
    <Empty
      image={<FolderOpenOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />}
      description={<Text>暂无错题，练习中做错的题目会自动收录到这里</Text>}
    >
      <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => navigate('/student/practice')}>
        去题库练习
      </Button>
    </Empty>
  );

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <StarOutlined />
        <Title level={4} style={{ marginBottom: 0 }}>
          我的题集
        </Title>
        <Text type="secondary" style={{ fontSize: 13, marginLeft: 4 }}>
          收藏想再练的题，错题自动收录，随时单题或组卷重练
        </Text>
      </div>

      {hasAssignment === false && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 16 }}
          message="尚未注册练习表格"
          description="「再练一次」会重置你的专属练习文件，请联系教师注册后再开练。"
        />
      )}

      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={(k) => { setActiveTab(k as 'fav' | 'wrong'); setSelectedRowKeys([]); }}
          items={[
            {
              key: 'fav',
              label: `收藏（${favorites.length}）`,
              children: (
                <>
                  {filterBar}
                  {selectedCount > 0 && (
                    <Space style={{ marginBottom: 12 }} wrap>
                      <Button
                        type="primary" icon={<ThunderboltOutlined />} loading={starting}
                        disabled={!hasAssignment}
                        onClick={() => handleRedo(selectedFavs.map(it => it.question.id))}
                      >
                        组卷练习（{selectedCount} 题）
                      </Button>
                      <Popconfirm
                        title={`取消收藏选中的 ${selectedCount} 道题？`}
                        onConfirm={handleBatchUnfavorite}
                      >
                        <Button danger icon={<DeleteOutlined />}>批量取消收藏</Button>
                      </Popconfirm>
                      <Button type="text" onClick={() => setSelectedRowKeys([])}>清空选择</Button>
                    </Space>
                  )}
                  <Table<FavoriteItem>
                    rowKey={(it) => it.id}
                    columns={favColumns}
                    dataSource={favList}
                    loading={loading}
                    size="middle"
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    rowSelection={{
                      selectedRowKeys,
                      onChange: (keys) => setSelectedRowKeys(keys),
                      preserveSelectedRowKeys: false,
                    }}
                    locale={{ emptyText: favEmpty }}
                  />
                </>
              ),
            },
            {
              key: 'wrong',
              label: `错题（${wrong.length}）`,
              children: (
                <>
                  {filterBar}
                  <Table<WrongItem>
                    rowKey={(it) => it.id}
                    columns={wrongColumns}
                    dataSource={wrongList}
                    loading={loading}
                    size="middle"
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    locale={{ emptyText: wrongEmpty }}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="题目详情与解析"
        open={!!detailQuestion}
        onCancel={() => setDetailQuestion(null)}
        footer={
          detailQuestion && (
            <Space>
              <Button
                type="primary" icon={<ThunderboltOutlined />} loading={starting}
                disabled={detailQuestion.status !== 'published'}
                onClick={() => { setDetailQuestion(null); handleRedo([detailQuestion.id]); }}
              >
                再练一次
              </Button>
              <Button onClick={() => setDetailQuestion(null)}>关闭</Button>
            </Space>
          )
        }
        width={640}
      >
        {detailQuestion && (
          <div>
            <Space wrap style={{ marginBottom: 8 }}>
              {questionTags(detailQuestion)}
              <Tag>{detailQuestion.score} 分</Tag>
            </Space>
            <Title level={5} style={{ marginTop: 0 }}>{detailQuestion.title}</Title>

            {detailQuestion.description && (
              <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
                {detailQuestion.description}
              </Paragraph>
            )}

            {detailQuestion.hints && (
              <Alert type="info" showIcon message="操作提示"
                description={<Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{detailQuestion.hints}</Paragraph>}
                style={{ marginBottom: 12 }}
              />
            )}

            <Alert
              type={detailQuestion.analysis ? 'success' : 'info'}
              showIcon
              message="解析"
              description={
                detailQuestion.analysis ? (
                  <Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{detailQuestion.analysis}</Paragraph>
                ) : (
                  <Text type="secondary">本题暂无教师解析</Text>
                )
              }
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
