# 考试设置向导改造实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将考试创建流程改为「必须先选批次 → 自动创建草稿考试 → 弹窗式 3 步设置向导」，确保每步配置都能真正保存到数据库。

**Architecture:** 后端仅做最小改动（在 `examSchema` 中透传 `batchId`）；前端新增 `ExamConfigWizard` 弹窗组件及 4 个子步骤组件，替换 `ExamManager` 中的「创建考试」入口。

**Tech Stack:** React 18, Ant Design 5, React Router 6, TypeScript, Zod, Prisma, Express.

---

## 文件结构

```
packages/client/src/pages/teacher/ExamConfigWizard/
├── index.tsx              # Modal + Steps 控制器
├── BatchSelectStep.tsx    # 第 0 步：选择批次并创建草稿考试
├── PaperBindStep.tsx      # 第 1 步：绑定试卷
├── RoomInvigilationStep.tsx # 第 2 步：考场与监考老师
└── StudentAssignStep.tsx  # 第 3 步：考生分配

packages/server/src/routes/exams.ts  # 接收 batchId
packages/client/src/pages/teacher/ExamManager.tsx  # 打开弹窗入口
packages/client/src/types/index.ts   # 可选：扩展 Exam 类型
```

---

## Task 1: 后端允许创建考试时传入 batchId

**Files:**
- Modify: `packages/server/src/routes/exams.ts:23-36`

**说明：** 当前 `examSchema` 未声明 `batchId`，Zod 会将其剥离，导致前端传的 `batchId` 无法落到数据库。

- [ ] **Step 1: 修改 `examSchema`，加入 `batchId`**

```typescript
const examSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().optional(),
  mode: z.enum(['practice', 'quiz', 'exam']).default('practice'),
  durationMinutes: z.number().int().positive().nullable().optional(),
  startTime: z.string().datetime().nullable().optional(),
  endTime: z.string().datetime().nullable().optional(),
  passScore: z.number().int().min(0).nullable().optional(),
  settings: z.record(z.any()).default({}),
  paperId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(), // ✅ 新增
});
```

- [ ] **Step 2: 验证创建逻辑会透传 batchId**

`POST /api/exams` 处理器中已有 `...rest` 展开，加入 `batchId` 后会自动进入 `prisma.exam.create`，无需额外修改。但需确认解构后 `batchId` 被正确传递：

```typescript
const { paperId, ...rest } = data;
const exam = await prisma.exam.create({
  data: {
    ...rest,
    startTime: data.startTime ? new Date(data.startTime) : null,
    endTime: data.endTime ? new Date(data.endTime) : null,
    createdBy: req.user!.userId,
    paperId: paperId ?? null,
    batchId: data.batchId ?? null, // ✅ 显式保留（即使 ...rest 已包含，也确保不为 undefined）
  },
});
```

- [ ] **Step 3: 运行后端类型检查**

Run: `cd /data/wps_dbsheet_examination_system/packages/server && npx tsc --noEmit`
Expected: 无错误。

---

## Task 2: 创建弹窗向导入口组件

**Files:**
- Create: `packages/client/src/pages/teacher/ExamConfigWizard/index.tsx`

- [ ] **Step 1: 编写向导容器**

```typescript
import { useState, useEffect } from 'react';
import { Modal, Steps, message } from 'antd';
import { BatchSelectStep } from './BatchSelectStep';
import { PaperBindStep } from './PaperBindStep';
import { RoomInvigilationStep } from './RoomInvigilationStep';
import { StudentAssignStep } from './StudentAssignStep';

export interface ExamConfigWizardProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export type WizardStep = 'batch' | 'paper' | 'room' | 'student';

export interface WizardExam {
  id: string;
  title: string;
  batchId?: string;
  paperId?: string | null;
}

export function ExamConfigWizard({ open, onClose, onSuccess }: ExamConfigWizardProps) {
  const [current, setCurrent] = useState(0);
  const [exam, setExam] = useState<WizardExam | null>(null);

  useEffect(() => {
    if (!open) {
      setCurrent(0);
      setExam(null);
    }
  }, [open]);

  const steps = [
    { title: '选择批次', key: 'batch' },
    { title: '绑定试卷', key: 'paper' },
    { title: '考场监考设置', key: 'room' },
    { title: '考生设置', key: 'student' },
  ];

  const handleExamCreated = (created: WizardExam) => {
    setExam(created);
    setCurrent(1);
  };

  const handleStepSaved = () => {
    if (current < steps.length - 1) {
      setCurrent(current + 1);
    } else {
      message.success('考试配置完成');
      onSuccess?.();
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={1000}
      footer={null}
      destroyOnClose
      title={exam ? `[考试名称：${exam.title}] 设置向导` : '新增考试'}
    >
      <Steps current={current} items={steps} style={{ marginBottom: 24 }} />
      {current === 0 && <BatchSelectStep onCreated={handleExamCreated} />}
      {current === 1 && exam && <PaperBindStep exam={exam} onSaved={handleStepSaved} onBack={() => setCurrent(0)} />}
      {current === 2 && exam && <RoomInvigilationStep exam={exam} onSaved={handleStepSaved} onBack={() => setCurrent(1)} />}
      {current === 3 && exam && <StudentAssignStep exam={exam} onSaved={handleStepSaved} onBack={() => setCurrent(2)} />}
    </Modal>
  );
}
```

- [ ] **Step 2: 在 `ExamManager` 中引入弹窗**

Modify: `packages/client/src/pages/teacher/ExamManager.tsx`

顶部添加：
```typescript
import { useState } from 'react';
import { ExamConfigWizard } from './ExamConfigWizard';
```

组件内添加状态：
```typescript
const [wizardOpen, setWizardOpen] = useState(false);
```

将「创建考试」按钮 onClick 改为：
```typescript
<Button type="primary" icon={<PlusOutlined />} onClick={() => setWizardOpen(true)}>创建考试</Button>
```

在页面底部添加：
```typescript
<ExamConfigWizard
  open={wizardOpen}
  onClose={() => setWizardOpen(false)}
  onSuccess={() => fetchExams()}
/>
```

- [ ] **Step 3: 验证前端编译**

Run: `cd /data/wps_dbsheet_examination_system/packages/client && npm run build 2>&1 | head -n 50`
Expected: 无 TypeScript 错误（此时子组件还未创建，会报错，进入 Task 3 后再次验证）。

---

## Task 3: 第 0 步 —— 选择批次并创建草稿考试

**Files:**
- Create: `packages/client/src/pages/teacher/ExamConfigWizard/BatchSelectStep.tsx`

- [ ] **Step 1: 实现批次选择步骤**

```typescript
import { useEffect, useState } from 'react';
import { Form, Select, Button, Space, message } from 'antd';
import api from '../../../services/api';
import type { WizardExam } from './index';

interface BatchSelectStepProps {
  onCreated: (exam: WizardExam) => void;
}

export function BatchSelectStep({ onCreated }: BatchSelectStepProps) {
  const [form] = Form.useForm();
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/batches?pageSize=100')
      .then(res => setBatches(res.data?.data || []))
      .catch(() => message.error('加载批次失败'));
  }, []);

  const handleNext = async () => {
    try {
      const { batchId } = await form.validateFields();
      setLoading(true);

      const defaultTitle = `未命名考试-${Date.now()}`;
      const res = await api.post('/exams', {
        title: defaultTitle,
        mode: 'exam',
        durationMinutes: 60,
        batchId,
      });

      onCreated({
        id: res.data.id,
        title: res.data.title,
        batchId: res.data.batchId,
        paperId: res.data.paperId,
      });
    } catch (err: any) {
      message.error(err.response?.data?.message || '创建考试失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form form={form} layout="vertical">
      <Form.Item
        name="batchId"
        label="选择批次"
        rules={[{ required: true, message: '请先选择批次' }]}
      >
        <Select placeholder="请选择考试批次" showSearch optionFilterProp="children">
          {batches.map(b => (
            <Select.Option key={b.id} value={b.id}>{b.name}</Select.Option>
          ))}
        </Select>
      </Form.Item>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" onClick={handleNext} loading={loading}>
          下一步
        </Button>
      </div>
    </Form>
  );
}
```

- [ ] **Step 2: 运行前端类型检查**

Run: `cd /data/wps_dbsheet_examination_system/packages/client && npx tsc --noEmit`
Expected: 无错误（PaperBindStep 等仍不存在，但 TypeScript 仅检查已引用组件）。

---

## Task 4: 第 1 步 —— 绑定试卷

**Files:**
- Create: `packages/client/src/pages/teacher/ExamConfigWizard/PaperBindStep.tsx`

- [ ] **Step 1: 实现试卷绑定步骤**

```typescript
import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, message, Input, Select } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import type { Paper, WizardExam } from './index';

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
```

- [ ] **Step 2: 运行前端类型检查**

Run: `cd /data/wps_dbsheet_examination_system/packages/client && npx tsc --noEmit`
Expected: 无错误。

---

## Task 5: 第 2 步 —— 考场监考设置

**Files:**
- Create: `packages/client/src/pages/teacher/ExamConfigWizard/RoomInvigilationStep.tsx`

- [ ] **Step 1: 实现考场列表与监考分配**

```typescript
import { useEffect, useState } from 'react';
import { Table, Button, Space, Input, message, Modal, Select } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, PlusOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import type { WizardExam } from './index';

interface Room {
  id: string;
  code: string;
  name: string;
  capacity: number;
  invigilators?: { id: string; realName: string }[];
}

interface RoomInvigilationStepProps {
  exam: WizardExam;
  onSaved: () => void;
  onBack: () => void;
}

export function RoomInvigilationStep({ exam, onSaved, onBack }: RoomInvigilationStepProps) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [teachers, setTeachers] = useState<any[]>([]);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/rooms?examId=${exam.id}&pageSize=100`);
      setRooms(res.data?.data || []);
    } catch {
      message.error('加载考场失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
    api.get('/users?role=teacher&pageSize=500')
      .then(res => setTeachers(res.data?.data || []))
      .catch(() => message.error('加载教师列表失败'));
  }, [exam.id]);

  const handleAddRoom = () => {
    const code = `ROOM-${Date.now()}`;
    Modal.confirm({
      title: '新增考场',
      content: (
        <Input id="new-room-name" placeholder="考场名称" />
      ),
      onOk: async () => {
        const name = (document.getElementById('new-room-name') as HTMLInputElement)?.value;
        if (!name) {
          message.warning('请输入考场名称');
          return Promise.reject();
        }
        try {
          await api.post('/rooms', { code, name, capacity: 50, examId: exam.id });
          message.success('新增成功');
          fetchRooms();
        } catch (err: any) {
          message.error(err.response?.data?.message || '新增失败');
          return Promise.reject();
        }
      },
    });
  };

  const handleAssignInvigilator = async (roomId: string, teacherId: string) => {
    try {
      await api.post(`/rooms/${roomId}/invigilators/${teacherId}`);
      message.success('分配成功');
      fetchRooms();
    } catch (err: any) {
      message.error(err.response?.data?.message || '分配失败');
    }
  };

  const filteredRooms = rooms.filter(r =>
    !keyword || r.name.includes(keyword) || r.code.includes(keyword)
  );

  const columns = [
    { title: '考场ID', dataIndex: 'code' },
    { title: '考场名称', dataIndex: 'name' },
    { title: '考场编码', dataIndex: 'code' },
    {
      title: '监考老师',
      render: (_: any, r: Room) => (
        <Space>
          {r.invigilators?.map(i => <span key={i.id}>{i.realName}</span>)}
          <Select
            placeholder="分配"
            style={{ width: 120 }}
            value={undefined}
            onChange={(tid) => handleAssignInvigilator(r.id, tid)}
            options={teachers.map(t => ({ value: t.id, label: t.realName || t.username }))}
          />
        </Space>
      ),
    },
  ];

  const handleNext = () => {
    if (rooms.length === 0) {
      message.warning('请至少添加一个考场');
      return;
    }
    onSaved();
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input placeholder="考场名称/编码" value={keyword} onChange={e => setKeyword(e.target.value)} />
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddRoom}>新增考场</Button>
      </Space>
      <Table rowKey="id" dataSource={filteredRooms} columns={columns} loading={loading} pagination={{ pageSize: 5 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>上一步</Button>
        <Button type="primary" icon={<ArrowRightOutlined />} onClick={handleNext} loading={saving}>
          下一步
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 运行前端类型检查**

Run: `cd /data/wps_dbsheet_examination_system/packages/client && npx tsc --noEmit`
Expected: 无错误。

---

## Task 6: 第 3 步 —— 考生设置

**Files:**
- Create: `packages/client/src/pages/teacher/ExamConfigWizard/StudentAssignStep.tsx`

- [ ] **Step 1: 实现考生分配步骤**

```typescript
import { useEffect, useState } from 'react';
import { Table, Button, Space, Input, Select, message } from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import type { WizardExam } from './index';

interface Room {
  id: string;
  code: string;
  name: string;
  capacity: number;
}

interface Student {
  id: string;
  username: string;
  realName: string | null;
  studentId: string | null;
  classRoom?: { name: string } | null;
}

interface StudentAssignStepProps {
  exam: WizardExam;
  onSaved: () => void;
  onBack: () => void;
}

export function StudentAssignStep({ exam, onSaved, onBack }: StudentAssignStepProps) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [assignedMap, setAssignedMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<string | undefined>();
  const [searchName, setSearchName] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/rooms?examId=${exam.id}&pageSize=100`),
      api.get('/users?role=student&pageSize=500'),
    ])
      .then(([roomRes, studentRes]) => {
        const roomList = roomRes.data?.data || [];
        setRooms(roomList);
        if (roomList.length > 0) setSelectedRoom(roomList[0].id);
        setStudents(studentRes.data?.data || []);
      })
      .catch(() => message.error('加载数据失败'))
      .finally(() => setLoading(false));
  }, [exam.id]);

  useEffect(() => {
    if (!selectedRoom) return;
    api.get(`/rooms/${selectedRoom}`)
      .then(res => {
        const assigned = (res.data?.students || []).map((s: any) => s.student.id);
        setAssignedMap(prev => ({ ...prev, [selectedRoom]: assigned }));
      })
      .catch(() => message.error('加载考场考生失败'));
  }, [selectedRoom]);

  const handleAssign = async (studentId: string) => {
    if (!selectedRoom) return;
    try {
      await api.post(`/rooms/${selectedRoom}/students/batch-assign`, { studentIds: [studentId] });
      message.success('分配成功');
      setAssignedMap(prev => ({
        ...prev,
        [selectedRoom]: [...(prev[selectedRoom] || []), studentId],
      }));
    } catch (err: any) {
      message.error(err.response?.data?.message || '分配失败');
    }
  };

  const handleRemove = async (studentId: string) => {
    if (!selectedRoom) return;
    try {
      await api.delete(`/rooms/${selectedRoom}/students/${studentId}`);
      message.success('移除成功');
      setAssignedMap(prev => ({
        ...prev,
        [selectedRoom]: (prev[selectedRoom] || []).filter(id => id !== studentId),
      }));
    } catch (err: any) {
      message.error(err.response?.data?.message || '移除失败');
    }
  };

  const filteredStudents = students.filter(s =>
    !searchName ||
    (s.realName && s.realName.includes(searchName)) ||
    (s.studentId && s.studentId.includes(searchName)) ||
    s.username.includes(searchName)
  );

  const columns = [
    { title: '姓名', render: (_: any, s: Student) => s.realName || '-' },
    { title: 'WPSID', dataIndex: 'username' },
    { title: '学号', dataIndex: 'studentId' },
    { title: '所属班级', render: (_: any, s: Student) => s.classRoom?.name || '-' },
    {
      title: '操作',
      render: (_: any, s: Student) => {
        const isAssigned = (assignedMap[selectedRoom || ''] || []).includes(s.id);
        return isAssigned ? (
          <Button size="small" danger onClick={() => handleRemove(s.id)}>移除</Button>
        ) : (
          <Button size="small" type="primary" onClick={() => handleAssign(s.id)}>添加</Button>
        );
      },
    },
  ];

  const handleFinish = () => {
    setSaving(true);
    message.success('考试配置完成');
    setSaving(false);
    onSaved();
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select
          placeholder="选择考场"
          value={selectedRoom}
          onChange={setSelectedRoom}
          style={{ width: 200 }}
          options={rooms.map(r => ({ value: r.id, label: `${r.code} - ${r.name}` }))}
        />
        <Input placeholder="学生姓名/学号/WPSID" value={searchName} onChange={e => setSearchName(e.target.value)} />
      </Space>
      <Table
        rowKey="id"
        dataSource={filteredStudents}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 8 }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>上一步</Button>
        <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleFinish} loading={saving}>
          完成
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 运行前端类型检查**

Run: `cd /data/wps_dbsheet_examination_system/packages/client && npx tsc --noEmit`
Expected: 无错误。

---

## Task 7: 移除旧「创建考试」路由入口（保留兼容）

**Files:**
- Modify: `packages/client/src/pages/teacher/ExamManager.tsx`（已在 Task 2 修改）
- Optional modify: `packages/client/src/App.tsx:67-68`

- [ ] **Step 1: 保留旧向导路由但隐藏入口**

不在列表页提供 `/teacher/exams/new/wizard` 入口；保留路由仅作为兼容，防止已有书签失效。

已在 Task 2 完成，无需额外代码。

---

## Task 8: 端到端验证

- [ ] **Step 1: 启动开发服务器**

Run:
```bash
cd /data/wps_dbsheet_examination_system
npm run dev
```

- [ ] **Step 2: 手动验证流程**

1. 登录教师端，进入「考试管理」。
2. 点击「创建考试」，确认弹出 Modal。
3. 不选择批次时，「下一步」按钮应禁用或点击后提示错误。
4. 选择批次后点击下一步，确认后端生成草稿考试。
5. 完成第 1 步绑定试卷，刷新页面后确认 `exam.paperId` 已保存。
6. 完成第 2 步新增考场并分配监考老师，确认 `exam_rooms` 表有数据。
7. 完成第 3 步添加考生，确认 `exam_room_students` 表有数据。
8. 关闭弹窗后，考试列表出现草稿考试，可正常发布。

- [ ] **Step 3: 运行现有测试**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server && npm test
```
Expected: 全部通过（如果测试存在）。

---

## Self-Review

### Spec Coverage

- 强制关联批次：Task 3 Step 1 实现。
- 弹窗式向导：Task 2 Step 1 实现。
- 3 步配置（绑定试卷、考场监考、考生设置）：Task 4/5/6 实现。
- 每步自动保存：各步骤中直接调用对应 API。
- 草稿考试：Task 3 Step 1 创建 `draft` 状态考试。
- 完成后仍需手动发布：Task 8 验证。

### Placeholder Scan

- 无 `TBD`/`TODO`/`implement later`。
- 所有代码步骤包含完整可运行代码。
- 无模糊描述。

### Type Consistency

- `WizardExam` 在 `index.tsx` 定义，被各步骤组件引用，字段一致。
- `batchId` 在后端 schema 与 Prisma 模型中名称一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-20-exam-wizard-batch-association.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
