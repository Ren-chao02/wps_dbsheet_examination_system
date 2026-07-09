# WPS 多维表格实操考试模式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有考试系统中增加「WPS 多维表格实操考试」模式，支持教师为每个考生分配独立空白多维表格、考生在分屏页面内操作表格、系统自动按规则判分。

**Architecture:** 新增 `ExamTableAssignment` 数据模型保存考试-考生-表格映射；考生开始考试时把 `fileId:accessToken` 写入 `StudentSubmission.tableSpaceId` 以复用现有判分链路；教师端在 `ExamConfigWizard` 增加表格分配步骤；学生端新增 `WpsExamDoing` 分屏页面，使用 WPS WebOffice SDK 嵌入表格。

**Tech Stack:** React + Ant Design（前端）、Express + Prisma + PostgreSQL（后端）、WPS WebOffice SDK、现有 KingsoftAdapter/rule-engine。

---

## 文件结构总览

| 文件 | 职责 |
|------|------|
| `packages/server/prisma/schema.prisma` | 新增 `ExamTableAssignment` 模型 |
| `packages/server/src/routes/exam-table-assignments.ts` | 表格分配的 CRUD 接口 |
| `packages/server/src/routes/my-exams.ts` | 新增 `POST /:id/start-wps` 启动接口 |
| `packages/server/src/routes/exams.ts` | 支持 `settings.requiresWpsTable` 的创建/更新 |
| `packages/server/src/app.ts` | 注册新的路由 |
| `packages/client/src/pages/teacher/ExamWizard.tsx` | 基本信息步骤增加「WPS 实操考试」开关 |
| `packages/client/src/pages/teacher/ExamConfigWizard/WpsTableAssignStep.tsx` | 新增表格分配向导步骤 |
| `packages/client/src/pages/teacher/ExamConfigWizard/index.tsx` | 向导加入第 5 步 |
| `packages/client/src/pages/student/WpsExamDoing.tsx` | 新增学生 WPS 实操考试页面 |
| `packages/client/src/pages/student/ExamIntro.tsx` | 根据考试模式跳转不同路由 |
| `packages/client/src/App.tsx` | 注册 `/student/exam/:id/wps` 路由 |
| `packages/client/src/services/api.ts` | 新增相关 API 调用方法 |

---

## Task 1: 数据库模型迁移

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: 在 schema.prisma 末尾追加 ExamTableAssignment 模型**

```prisma
model ExamTableAssignment {
  id          String   @id @default(uuid()) @db.Uuid
  examId      String   @map("exam_id") @db.Uuid
  studentId   String   @map("student_id") @db.Uuid
  fileId      String   @map("file_id") @db.Text
  shareUrl    String?  @map("share_url") @db.Text
  accessToken String?  @map("access_token") @db.Text
  assignedBy  String   @map("assigned_by") @db.Uuid
  assignedAt  DateTime @default(now()) @map("assigned_at")

  exam     Exam @relation(fields: [examId], references: [id], onDelete: Cascade)
  student  User @relation(fields: [studentId], references: [id])
  assigner User @relation(fields: [assignedBy], references: [id])

  @@unique([examId, studentId])
  @@unique([examId, fileId])
  @@index([examId])
  @@map("exam_table_assignments")
}
```

- [ ] **Step 2: 生成并应用迁移**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
npx prisma migrate dev --name add_exam_table_assignments
```

Expected: migration created and applied successfully.

- [ ] **Step 3: 重新生成 Prisma Client**

Run:
```bash
npx prisma generate
```

Expected: client generated.

- [ ] **Step 4: Commit**

```bash
git add packages/server/prisma/
git commit -m "feat: add ExamTableAssignment model for WPS hands-on exam"
```

---

## Task 2: 后端表格分配 CRUD 接口

**Files:**
- Create: `packages/server/src/routes/exam-table-assignments.ts`
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: 创建路由文件**

Create `packages/server/src/routes/exam-table-assignments.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const examTableAssignmentRouter = Router();
examTableAssignmentRouter.use(authenticate);
examTableAssignmentRouter.use(authorize('teacher', 'admin'));

function extractFileId(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('http')) {
    const match = trimmed.match(/\/l\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : trimmed;
  }
  return trimmed;
}

// GET /api/exam-table-assignments/:examId
examTableAssignmentRouter.get('/:examId', async (req: Request, res: Response) => {
  try {
    const { examId } = req.params;
    const assignments = await prisma.examTableAssignment.findMany({
      where: { examId },
      include: {
        student: { select: { id: true, realName: true, username: true, studentId: true } },
      },
      orderBy: { assignedAt: 'asc' },
    });
    res.json({ assignments });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exam-table-assignments/:examId/bulk
examTableAssignmentRouter.post('/:examId/bulk', async (req: Request, res: Response) => {
  try {
    const { examId } = req.params;
    const { items } = req.body as { items: { studentId: string; shareUrl: string; accessToken: string }[] };

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: '缺少分配数据' });
    }

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) return res.status(404).json({ message: '考试不存在' });

    const assignments = items.map(item => {
      const fileId = extractFileId(item.shareUrl);
      return {
        examId,
        studentId: item.studentId,
        fileId,
        shareUrl: item.shareUrl.trim(),
        accessToken: item.accessToken,
        assignedBy: req.user!.userId,
      };
    });

    // 先删除该考试下这些学生的旧分配
    await prisma.examTableAssignment.deleteMany({
      where: {
        examId,
        studentId: { in: assignments.map(a => a.studentId) },
      },
    });

    await prisma.examTableAssignment.createMany({
      data: assignments,
      skipDuplicates: true,
    });

    res.json({ count: assignments.length });
  } catch (err: any) {
    res.status(500).json({ message: '服务器错误', detail: err.message });
  }
});

// DELETE /api/exam-table-assignments/:examId/:studentId
examTableAssignmentRouter.delete('/:examId/:studentId', async (req: Request, res: Response) => {
  try {
    const { examId, studentId } = req.params;
    await prisma.examTableAssignment.deleteMany({
      where: { examId, studentId },
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 2: 在 app.ts 注册路由**

Modify `packages/server/src/app.ts`, add import:

```typescript
import { examTableAssignmentRouter } from './routes/exam-table-assignments';
```

Add route registration after other routers:

```typescript
app.use('/api/exam-table-assignments', examTableAssignmentRouter);
```

- [ ] **Step 3: 编译检查**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/exam-table-assignments.ts packages/server/src/app.ts
git commit -m "feat: add exam table assignment CRUD APIs"
```

---

## Task 3: 学生启动 WPS 考试接口

**Files:**
- Modify: `packages/server/src/routes/my-exams.ts`

- [ ] **Step 1: 在 my-exams.ts 中新增 start-wps 端点**

Add after the existing `/start` handler (around line 280):

```typescript
// POST /api/my-exams/:id/start-wps — 开始 WPS 实操考试
myExamRouter.post('/:id/start-wps', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: { examQuestions: { include: { question: true }, orderBy: { sortOrder: 'asc' } } },
    });

    if (!exam) return res.status(404).json({ message: '考试不存在' });
    if (exam.status !== 'published' && exam.status !== 'in_progress') {
      return res.status(400).json({ message: '考试未发布或已结束' });
    }

    const settings = (exam.settings || {}) as any;
    if (!settings.requiresWpsTable) {
      return res.status(400).json({ message: '该考试不是 WPS 实操考试' });
    }

    const assignment = await prisma.examTableAssignment.findUnique({
      where: {
        examId_studentId: {
          examId: req.params.id,
          studentId: req.user!.userId,
        },
      },
    });

    if (!assignment) {
      return res.status(400).json({ message: '尚未分配 WPS 表格，请联系教师' });
    }

    // 复用 start 逻辑创建/更新 submission
    let submission = await prisma.studentSubmission.findUnique({
      where: {
        examId_studentId: {
          examId: req.params.id,
          studentId: req.user!.userId,
        },
      },
    });

    const tableSpaceId = `${assignment.fileId}:${assignment.accessToken || ''}`;

    if (submission) {
      submission = await prisma.studentSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'in_progress',
          startedAt: new Date(),
          tableSpaceId,
        },
      });
    } else {
      submission = await prisma.studentSubmission.create({
        data: {
          examId: req.params.id,
          studentId: req.user!.userId,
          status: 'in_progress',
          startedAt: new Date(),
          tableSpaceId,
          details: {
            create: exam.examQuestions.map(eq => ({ questionId: eq.questionId })),
          },
        },
      });
      await prisma.examSession.create({
        data: {
          submissionId: submission.id,
          studentId: req.user!.userId,
          examId: req.params.id,
          ipAddress: req.ip || req.socket.remoteAddress || null,
        },
      });
    }

    res.json({
      submission,
      shareUrl: assignment.shareUrl,
      fileId: assignment.fileId,
      questions: exam.examQuestions.map(eq => ({
        ...eq.question,
        scoreOverride: eq.scoreOverride,
        sortOrder: eq.sortOrder,
      })),
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 2: 编译检查**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/my-exams.ts
git commit -m "feat: add start-wps endpoint for hands-on exam"
```

---

## Task 4: 考试创建支持 WPS 实操模式

**Files:**
- Modify: `packages/server/src/routes/exams.ts`
- Modify: `packages/client/src/pages/teacher/ExamWizard.tsx`

- [ ] **Step 1: 确认 exams.ts 创建接口透传 settings**

Read `packages/server/src/routes/exams.ts` POST handler. If it already saves `settings` from body, no change needed. If not, modify to include:

```typescript
const { title, description, mode, durationMinutes, startTime, endTime, totalScore, passScore, paperId, batchId, settings } = req.body;
// ...
const exam = await prisma.exam.create({
  data: {
    title,
    description,
    mode,
    durationMinutes,
    startTime: startTime ? new Date(startTime) : null,
    endTime: endTime ? new Date(endTime) : null,
    totalScore: totalScore || 0,
    passScore,
    paperId,
    batchId,
    settings: settings || {},
    createdBy: req.user!.userId,
  },
});
```

- [ ] **Step 2: 在 ExamWizard 基本信息步骤增加 WPS 开关**

Modify `packages/client/src/pages/teacher/ExamWizard.tsx`:

In `WizardData.basicInfo`, add:

```typescript
requiresWpsTable: boolean;
```

In `INITIAL_DATA.basicInfo`, add:

```typescript
requiresWpsTable: false,
```

In the Step 0 form (after shuffleQuestions switch), add:

```tsx
<Form.Item name="requiresWpsTable" label="WPS 实操考试" valuePropName="checked">
  <Switch checkedChildren="是" unCheckedChildren="否" />
</Form.Item>
<Text type="secondary" style={{ marginLeft: 8 }}>
  开启后考生将直接进入 WPS 多维表格操作界面，需在配置向导中分配表格
</Text>
```

In `handleSubmit`, ensure the setting is included:

```typescript
const examPayload = {
  ...wizardData.basicInfo,
  batchId: wizardData.basicInfo.batchId || null,
  paperId: wizardData.paperInfo.paperId || null,
  settings: { requiresWpsTable: wizardData.basicInfo.requiresWpsTable },
};
```

- [ ] **Step 3: 编译/构建检查前端**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/client
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/exams.ts packages/client/src/pages/teacher/ExamWizard.tsx
git commit -m "feat: support requiresWpsTable flag when creating exam"
```

---

## Task 5: 教师表格分配向导步骤

**Files:**
- Create: `packages/client/src/pages/teacher/ExamConfigWizard/WpsTableAssignStep.tsx`

- [ ] **Step 1: 创建分配步骤组件**

Create `packages/client/src/pages/teacher/ExamConfigWizard/WpsTableAssignStep.tsx`:

```typescript
import { useEffect, useState } from 'react';
import {
  Button, Card, Input, Table, message, Space, Typography, Alert, Spin, Tabs
} from 'antd';
import { SaveOutlined, ImportOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import { useAuthStore } from '../../../stores/auth';

const { Text, TextArea } = Typography;

interface WpsTableAssignStepProps {
  exam: { id: string; title: string };
  onSaved: () => void;
  onBack: () => void;
}

interface StudentRow {
  studentId: string;
  realName: string;
  username: string;
  studentIdNumber: string | null;
  shareUrl: string;
}

export function WpsTableAssignStep({ exam, onSaved, onBack }: WpsTableAssignStepProps) {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const { user } = useAuthStore();

  // 从本地存储读取教师授权时缓存的 access_token（简化方案）
  const accessToken = user?.wpsAccessToken || '';

  useEffect(() => {
    loadData();
  }, [exam.id]);

  const loadData = async () => {
    try {
      // 获取已报名/已分配学生及当前分配
      const [studentsRes, assignmentsRes] = await Promise.all([
        api.get(`/exams/${exam.id}/students`),
        api.get(`/exam-table-assignments/${exam.id}`),
      ]);

      const assignedMap = new Map(
        (assignmentsRes.data.assignments || []).map((a: any) => [a.studentId, a])
      );

      setStudents((studentsRes.data.students || []).map((s: any) => {
        const assigned = assignedMap.get(s.id);
        return {
          studentId: s.id,
          realName: s.realName || s.username,
          username: s.username,
          studentIdNumber: s.studentId || null,
          shareUrl: assigned?.shareUrl || '',
        };
      }));
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleShareUrlChange = (studentId: string, value: string) => {
    setStudents(prev => prev.map(s =>
      s.studentId === studentId ? { ...s, shareUrl: value } : s
    ));
  };

  const handleSave = async () => {
    const items = students
      .filter(s => s.shareUrl.trim())
      .map(s => ({
        studentId: s.studentId,
        shareUrl: s.shareUrl.trim(),
        accessToken,
      }));

    if (items.length === 0) {
      message.warning('请至少为一个考生填写分享链接');
      return;
    }

    if (!accessToken) {
      message.warning('请先完成 WPS Token 授权');
      return;
    }

    setSaving(true);
    try {
      await api.post(`/exam-table-assignments/${exam.id}/bulk`, { items });
      message.success('分配保存成功');
      onSaved();
    } catch (err: any) {
      message.error(err.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkImport = () => {
    const lines = bulkText.split('\n').filter(l => l.trim());
    const map = new Map<string, string>();
    for (const line of lines) {
      const parts = line.split(/[,\s]+/).filter(Boolean);
      if (parts.length >= 2) {
        map.set(parts[0].trim(), parts[1].trim());
      }
    }

    setStudents(prev => prev.map(s => {
      const key = s.studentIdNumber || s.username;
      if (map.has(key)) {
        return { ...s, shareUrl: map.get(key)! };
      }
      return s;
    }));
    message.success('批量导入完成');
    setBulkText('');
  };

  const columns = [
    { title: '姓名', dataIndex: 'realName', width: 120 },
    { title: '学号', dataIndex: 'studentIdNumber', width: 140, render: (v: string) => v || '-' },
    { title: '用户名', dataIndex: 'username', width: 140 },
    {
      title: 'WPS 多维表格分享链接',
      render: (_: any, record: StudentRow) => (
        <Input
          placeholder="https://www.kdocs.cn/l/xxxxxx"
          value={record.shareUrl}
          onChange={(e) => handleShareUrlChange(record.studentId, e.target.value)}
        />
      ),
    },
  ];

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;

  return (
    <Card title="WPS 多维表格分配">
      <Alert
        type="info"
        showIcon
        message="请先在 WPS 中为每个考生创建空白多维表格，然后将分享链接粘贴到下方。"
        style={{ marginBottom: 16 }}
      />

      <Tabs
        items={[
          {
            key: 'list',
            label: '逐个分配',
            children: (
              <Table
                dataSource={students}
                rowKey="studentId"
                columns={columns}
                pagination={{ pageSize: 20 }}
                size="small"
              />
            ),
          },
          {
            key: 'bulk',
            label: '批量导入',
            children: (
              <div>
                <Text type="secondary">
                  每行格式：学号/用户名 + 空格/逗号 + 分享链接
                </Text>
                <TextArea
                  rows={10}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={`2024001 https://www.kdocs.cn/l/abc123\n2024002 https://www.kdocs.cn/l/def456`}
                  style={{ marginTop: 8, marginBottom: 12 }}
                />
                <Button icon={<ImportOutlined />} onClick={handleBulkImport}>
                  应用批量导入
                </Button>
              </div>
            ),
          },
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <Button onClick={onBack}>上一步</Button>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
          保存并下一步
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/pages/teacher/ExamConfigWizard/WpsTableAssignStep.tsx
git commit -m "feat: add WPS table assignment step UI"
```

---

## Task 6: 将分配步骤接入考试配置向导

**Files:**
- Modify: `packages/client/src/pages/teacher/ExamConfigWizard/index.tsx`

- [ ] **Step 1: 导入新步骤并加入向导**

Modify `packages/client/src/pages/teacher/ExamConfigWizard/index.tsx`:

Add import:

```typescript
import { WpsTableAssignStep } from './WpsTableAssignStep';
```

Update steps array:

```typescript
const steps = [
  { title: '选择批次', key: 'batch' },
  { title: '绑定试卷', key: 'paper' },
  { title: '考场监考设置', key: 'room' },
  { title: '考生设置', key: 'student' },
  { title: 'WPS 表格分配', key: 'wps-table' },
];
```

Add rendering condition:

```typescript
{current === 4 && exam && <WpsTableAssignStep exam={exam} onSaved={handleStepSaved} onBack={() => setCurrent(3)} />}
```

- [ ] **Step 2: 构建检查前端**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/client
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/pages/teacher/ExamConfigWizard/index.tsx
git commit -m "feat: integrate WPS table assignment into exam config wizard"
```

---

## Task 7: 学生 WPS 实操考试页面

**Files:**
- Create: `packages/client/src/pages/student/WpsExamDoing.tsx`

- [ ] **Step 1: 创建页面组件**

Create `packages/client/src/pages/student/WpsExamDoing.tsx`:

```typescript
import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Card, Statistic, Typography, Tag, Modal, message, Spin, Alert, Space } from 'antd';
import { CheckOutlined, ClockCircleOutlined, WarningOutlined, LinkOutlined } from '@ant-design/icons';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { Question } from '../../types';
import { FullscreenGuard, exitFullscreen } from '../../components/exam/FullscreenGuard';

declare global {
  interface Window {
    WebOfficeSDK?: any;
  }
}

const { Text, Paragraph } = Typography;
const { Countdown } = Statistic;

export function WpsExamDoingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [iframeError, setIframeError] = useState(false);
  const sdkRef = useRef<any>(null);
  const { user } = useAuthStore();
  const submittedRef = useRef(false);

  useEffect(() => {
    api.post(`/my-exams/${id}/start-wps`).then(res => {
      const d = res.data;
      setData(d);
      if (d.submission?.startedAt && d.exam?.durationMinutes) {
        const start = new Date(d.submission.startedAt).getTime();
        setDeadline(start + d.exam.durationMinutes * 60 * 1000);
      }
      loadWpsSdk(d.shareUrl);
    }).catch((err) => {
      message.error(err.response?.data?.message || '加载失败');
    }).finally(() => setLoading(false));
  }, [id]);

  const loadWpsSdk = (shareUrl: string) => {
    if (!shareUrl) return;
    if (!window.WebOfficeSDK) {
      // 动态加载 SDK
      const script = document.createElement('script');
      script.src = 'https://open.wps.cn/js/sdk/weboffice-sdk-v1.1.8.umd.js';
      script.async = true;
      script.onload = () => initSdk(shareUrl);
      script.onerror = () => setIframeError(true);
      document.body.appendChild(script);
    } else {
      initSdk(shareUrl);
    }
  };

  const initSdk = (shareUrl: string) => {
    try {
      sdkRef.current = window.WebOfficeSDK.config({
        url: `${shareUrl}?embed=1&disablePlugins`,
        fileType: 'd',
        mode: 'embed',
        viewMode: 'Embed',
        mount: document.getElementById('wps-table-container'),
        commonOptions: {
          isEnableChangeDocumentTitle: false,
          isShowHeader: false,
          disableSafeCs: true,
        },
      });
    } catch {
      setIframeError(true);
    }
  };

  const doSubmit = useCallback(async (auto = false) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      await api.post(`/my-exams/${id}/submit`);
      message.success(auto ? '考试时间已到，已自动提交' : '提交成功！');
      exitFullscreen();
      navigate(`/student/exam/${id}/result`);
    } catch (err: any) {
      message.error(err.response?.data?.message || '提交失败');
      submittedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [id, navigate]);

  const handleTimerFinish = useCallback(() => {
    if (!submittedRef.current) doSubmit(true);
  }, [doSubmit]);

  const handleSubmit = () => {
    Modal.confirm({
      title: '确认提交',
      content: '提交后将无法修改，确定要提交答卷吗？',
      okText: '确认提交',
      cancelText: '再检查一下',
      onOk: () => doSubmit(false),
    });
  };

  const openInNewTab = () => {
    if (data?.shareUrl) window.open(data.shareUrl, '_blank');
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (!data) return null;

  const questions: Question[] = data.questions || [];
  const currentQuestion = questions[currentStep];

  return (
    <FullscreenGuard active={true} onExit={() => {}}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 24px', background: '#fff', borderBottom: '1px solid #f0f0f0'
        }}>
          <h2 style={{ margin: 0 }}>{data.exam?.title || 'WPS 实操考试'}</h2>
          <Space>
            {deadline && (
              <div style={{
                background: '#fff', padding: '4px 16px', borderRadius: 8,
                border: '2px solid #1890ff', display: 'flex', alignItems: 'center'
              }}>
                <Countdown
                  title={<span style={{ fontSize: 12 }}><ClockCircleOutlined /> 剩余时间</span>}
                  value={deadline}
                  format="HH:mm:ss"
                  onFinish={handleTimerFinish}
                  valueStyle={{ fontSize: 20, fontWeight: 700, color: '#1890ff' }}
                />
              </div>
            )}
            <Button type="primary" danger onClick={handleSubmit} loading={submitting} icon={<CheckOutlined />}>
              提交答卷
            </Button>
          </Space>
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left: questions */}
          <div style={{ width: 420, borderRight: '1px solid #f0f0f0', overflow: 'auto', padding: 16, background: '#f5f5f5' }}>
            {currentQuestion ? (
              <Card title={`第 ${currentStep + 1} 题`} size="small" style={{ marginBottom: 16 }}>
                <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 15, marginBottom: 16 }}>
                  {currentQuestion.description}
                </Paragraph>
                {currentQuestion.hints && (
                  <Alert type="warning" showIcon message="提示" description={currentQuestion.hints} style={{ marginBottom: 16 }} />
                )}
                <div>
                  <Tag>{currentQuestion.difficulty === 'easy' ? '简单' : currentQuestion.difficulty === 'medium' ? '中等' : '困难'}</Tag>
                  <Text type="secondary">{currentQuestion.score} 分</Text>
                </div>
              </Card>
            ) : null}

            <Card title="答题卡" size="small">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {questions.map((q, i) => (
                  <Button
                    key={q.id}
                    type={i === currentStep ? 'primary' : 'default'}
                    size="small"
                    onClick={() => setCurrentStep(i)}
                  >
                    {i + 1}
                  </Button>
                ))}
              </div>
            </Card>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <Button disabled={currentStep === 0} onClick={() => setCurrentStep(s => s - 1)}>上一题</Button>
              <Button
                type="primary"
                onClick={() => currentStep < questions.length - 1 ? setCurrentStep(s => s + 1) : handleSubmit()}
              >
                {currentStep < questions.length - 1 ? '下一题' : '提交答卷'}
              </Button>
            </div>
          </div>

          {/* Right: WPS iframe */}
          <div style={{ flex: 1, position: 'relative', background: '#f0f2f5' }}>
            {iframeError ? (
              <div style={{ textAlign: 'center', paddingTop: 100 }}>
                <WarningOutlined style={{ fontSize: 48, color: '#faad14' }} />
                <h3>WPS 表格无法在当前页面内嵌打开</h3>
                <Text type="secondary">请点击下方按钮在新标签页打开表格，操作完成后返回本页面交卷。</Text>
                <div style={{ marginTop: 16 }}>
                  <Button type="primary" icon={<LinkOutlined />} onClick={openInNewTab}>
                    在新标签页打开 WPS 表格
                  </Button>
                </div>
              </div>
            ) : (
              <div id="wps-table-container" style={{ width: '100%', height: '100%' }} />
            )}
          </div>
        </div>
      </div>
    </FullscreenGuard>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/pages/student/WpsExamDoing.tsx
git commit -m "feat: add student WPS hands-on exam page"
```

---

## Task 8: 学生路由与考试入口切换

**Files:**
- Modify: `packages/client/src/App.tsx`
- Modify: `packages/client/src/pages/student/ExamIntro.tsx`

- [ ] **Step 1: 注册新路由**

Modify `packages/client/src/App.tsx`:

Add import:

```typescript
import { WpsExamDoingPage } from './pages/student/WpsExamDoing';
```

Add route inside `/student` block:

```typescript
<Route path="exam/:id/wps" element={<WpsExamDoingPage />} />
```

- [ ] **Step 2: ExamIntro 根据考试模式跳转**

Modify `packages/client/src/pages/student/ExamIntro.tsx`:

```typescript
const handleStart = async () => {
  if (!agreed) {
    message.warning('请先阅读并同意考试规则');
    return;
  }

  Modal.confirm({
    title: '确认开始考试',
    content: '开始后计时器将启动，请确保环境安静、网络稳定。',
    okText: '确认开始',
    cancelText: '取消',
    onOk: async () => {
      setStarting(true);
      try {
        const settings = exam?.settings || {};
        if (settings.requiresWpsTable) {
          navigate(`/student/exam/${id}/wps`);
        } else {
          await api.post(`/my-exams/${id}/start`);
          navigate(`/student/exam/${id}/doing`);
        }
      } catch (err: any) {
        message.error(err.response?.data?.message || '开始失败');
      } finally {
        setStarting(false);
      }
    },
  });
};
```

- [ ] **Step 3: 构建检查前端**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/client
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/App.tsx packages/client/src/pages/student/ExamIntro.tsx
git commit -m "feat: route students to WPS exam page when requiresWpsTable is enabled"
```

---

## Task 9: 提交后自动触发判分

**Files:**
- Modify: `packages/server/src/routes/my-exams.ts`

- [ ] **Step 1: 在 submit 成功后异步触发判分**

Modify `packages/server/src/routes/my-exams.ts`, in the `POST /:id/submit` handler, after updating submission to 'submitted':

```typescript
import { gradeSubmission } from '../services/grading-service';
// ...

const updated = await prisma.studentSubmission.update({
  where: { id: submission.id },
  data: {
    status: 'submitted',
    submittedAt: new Date(),
  },
});

// 异步触发自动判分，不阻塞响应
gradeSubmission(submission.id).catch(err => {
  console.error(`[my-exams] 自动判分失败: ${submission.id}`, err);
});

res.json(updated);
```

- [ ] **Step 2: 构建检查后端**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/my-exams.ts
git commit -m "feat: trigger auto grading after WPS exam submission"
```

---

## Task 10: 验证与测试

**Files:**
- N/A

- [ ] **Step 1: 启动开发环境**

Run:
```bash
cd /data/wps_dbsheet_examination_system
npm run dev
```

Expected: both client and server start without errors.

- [ ] **Step 2: 测试教师创建 WPS 考试**

1. 以教师身份登录，进入「创建考试（向导模式）」。
2. 基本信息步骤开启「WPS 实操考试」。
3. 完成后续步骤创建考试。
4. 进入考试配置向导，完成前 4 步。
5. 第 5 步「WPS 表格分配」中，为考生粘贴分享链接。
6. 确认 `exam_table_assignments` 表中有对应记录。

- [ ] **Step 3: 测试学生进入 WPS 考试**

1. 以学生身份登录，进入该考试的介绍页。
2. 点击「开始答题」。
3. 确认跳转到 `/student/exam/:id/wps`。
4. 确认右侧 iframe 中加载了 WPS 多维表格。
5. 确认左侧题目可切换，倒计时正常。

- [ ] **Step 4: 测试交卷与判分**

1. 学生点击「提交答卷」。
2. 检查 `StudentSubmission.status` 是否变为 `graded` 或 `grading`。
3. 检查 `VerificationResult` 表中是否生成了规则验证记录。
4. 检查试卷总分是否写入 `StudentSubmission.totalScore`。

- [ ] **Step 5: iframe 加载失败降级测试**

1. 使用一个无效分享链接或在浏览器中禁用第三方脚本。
2. 确认页面显示「在新标签页打开 WPS 表格」按钮。
3. 点击后在新标签打开表格，返回本页面仍可交卷。

- [ ] **Step 6: Commit any test fixes**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: address issues found during WPS hands-on exam testing"
```

---

## Self-Review

- **Spec coverage:** 所有设计要点（数据模型、教师分配、学生页面、判分、异常处理）均有对应任务。
- **Placeholder scan:** 无 TBD/TODO，所有步骤包含具体代码或命令。
- **Type consistency:** `requiresWpsTable` 在前后端命名一致；`ExamTableAssignment` 字段名与 API/组件一致。
- **Gap:** `WpsTableAssignStep` 中使用了 `user?.wpsAccessToken`，但当前 `auth.ts` store 中没有该字段。实施时需在 store 中补充，或在分配步骤引导教师前往「WPS Token 管理」页面授权后通过接口获取 token。该细节可在 Task 5 实施时调整。
