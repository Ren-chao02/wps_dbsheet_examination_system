import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Tag, Button, Spin, Empty, message, Input } from 'antd';
import { FileTextOutlined, ClockCircleOutlined, SearchOutlined, PlayCircleOutlined } from '@ant-design/icons';
import api from '../../services/api';

interface PaperItem {
  id: string;
  name: string;
  description: string | null;
  difficulty: string | null;
  totalScore: number;
  passScore: number | null;
  _count: { paperQuestions: number };
}

export function PracticeList() {
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchPapers();
  }, []);

  const fetchPapers = async () => {
    try {
      setLoading(true);
      const res = await api.get('/papers?pageSize=100&source=local');
      setPapers(res.data?.data || []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const filtered = searchText
    ? papers.filter(p => p.name.toLowerCase().includes(searchText.toLowerCase()))
    : papers;

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>题库练习</h2>
        <Input
          placeholder="搜索试卷..."
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          style={{ width: 260 }}
          allowClear
        />
      </div>

      {filtered.length === 0 ? (
        <Empty description={searchText ? '未找到匹配的试卷' : '暂无可用试卷'} style={{ marginTop: 100 }} />
      ) : (
        <Row gutter={[16, 16]}>
          {filtered.map(paper => (
            <Col xs={24} sm={12} lg={8} key={paper.id}>
              <Card
                hoverable
                title={
                  <span>
                    <FileTextOutlined style={{ marginRight: 6 }} />
                    {paper.name}
                  </span>
                }
                extra={
                  paper.difficulty && (
                    <Tag color={paper.difficulty === 'easy' ? 'green' : paper.difficulty === 'medium' ? 'blue' : 'red'}>
                      {paper.difficulty === 'easy' ? '简单' : paper.difficulty === 'medium' ? '中等' : '困难'}
                    </Tag>
                  )
                }
                onClick={() => navigate(`/student/practice/${paper.id}`)}
              >
                <div style={{ color: '#666', marginBottom: 12, minHeight: 40 }}>
                  {paper.description || '暂无描述'}
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#888' }}>
                  <span><FileTextOutlined /> {paper._count.paperQuestions || 0} 题</span>
                  <span>满分 {paper.totalScore} 分</span>
                  {paper.passScore && <span>及格 {paper.passScore} 分</span>}
                </div>
                <div style={{ marginTop: 12 }}>
                  <Button type="primary" icon={<PlayCircleOutlined />} size="small">
                    开始练习
                  </Button>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
