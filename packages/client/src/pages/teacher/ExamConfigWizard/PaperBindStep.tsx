import { useEffect, useState } from 'react';
import { Table, Button, Space, Input, Select, message } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import type { Paper } from '../../../types';
import type { WizardExam } from './index';

interface PaperBindStepProps {
  exam: WizardExam;
  onSaved: () => void;
  onBack: () => void;
}

export function PaperBindStep({ exam, onSaved, onBack }: PaperBindStepProps) {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(exam.paperId || null);
  const [searchName, setSearchName] = useState('');
  const [source, setSource] = useState<string | undefined>();

  useEffect(() => {
    setLoading(true);
    api.get('/papers?pageSize=100')
      .then(res => setPapers(res.data?.data || []))
      .catch(() => message.error('加载试卷失败'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = papers.filter(p => {
    const matchName = !searchName || p.name.toLowerCase().includes(searchName.toLowerCase());
    const matchSource = !source || p.source === source;
    return matchName && matchSource;
  });

  const handleSave = async () => {
    if (!selectedPaperId) {
      message.warning('请选择一份试卷');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/exams/${exam.id}`, {
        title: exam.title,
        mode: 'exam',
        durationMinutes: 60,
        paperId: selectedPaperId,
      });
      message.success('试卷绑定成功');
      onSaved();
    } catch (err: any) {
      message.error(err.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { title: '考卷名称', dataIndex: 'name' },
    { title: '试卷总分', dataIndex: 'totalScore' },
    { title: '考卷来源', dataIndex: 'source' },
    {
      title: '题目数',
      render: (_: any, r: Paper) => r._count?.paperQuestions ?? 0,
    },
    {
      title: '操作',
      render: (_: any, r: Paper) => (
        <Button
          type={selectedPaperId === r.id ? 'primary' : 'default'}
          size="small"
          onClick={() => setSelectedPaperId(r.id)}
        >
          {selectedPaperId === r.id ? '已选择' : '选择'}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input placeholder="考卷名称" value={searchName} onChange={e => setSearchName(e.target.value)} />
        <Select placeholder="考卷来源" allowClear value={source} onChange={setSource} style={{ width: 120 }}>
          <Select.Option value="local">校本</Select.Option>
          <Select.Option value="official">官方</Select.Option>
        </Select>
      </Space>
      <Table
        rowKey="id"
        dataSource={filtered}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 5 }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>上一步</Button>
        <Button type="primary" icon={<ArrowRightOutlined />} onClick={handleSave} loading={saving}>
          下一步
        </Button>
      </div>
    </div>
  );
}
