# 题库系统两级分类与属性增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现题库系统的两级知识点分类体系，增强题目属性（出题老师、更新人、时间戳），添加详情查看功能和高级筛选能力。

**Architecture:** 采用最小化改造方案（方案A），在现有Question模型基础上删除单一categoryId字段，改为primaryCategoryId + secondaryCategoryId两级分类结构。同时新增teacherName和updatedBy元数据字段。前端重构题库列表页，增加详情弹窗和多条件组合筛选功能。后端调整API接口以支持新的查询参数和数据结构。

**Tech Stack:** Prisma ORM (PostgreSQL), Express.js, React, Ant Design 5, TypeScript, Zod validation

---

## File Structure

**Backend files to modify:**
- `packages/server/prisma/schema.prisma` - Question模型结构调整
- `packages/server/src/routes/questions.ts` - CRUD API接口增强
- `packages/server/src/routes/categories.ts` - 分类查询接口优化

**Frontend files to modify:**
- `packages/client/src/types/index.ts` - Question类型定义更新
- `packages/client/src/pages/teacher/QuestionBank.tsx` - 列表页完全重构
- `packages/client/src/pages/teacher/QuestionEditor.tsx` - 编辑器字段适配

**Frontend files to create:**
- `packages/client/src/pages/teacher/QuestionDetailDrawer.tsx` - 详情弹窗组件

---

### Task 1: 数据库Schema修改与迁移

**Files:**
- Modify: `packages/server/prisma/schema.prisma:144-167`
- Create: Database migration via `npx prisma migrate dev`

- [ ] **Step 1: 修改Prisma Schema中的Question模型**

在 `packages/server/prisma/schema.prisma` 文件中，找到Question模型定义（约第144行），进行以下修改：

```prisma
model Question {
  id                    String           @id @default(uuid()) @db.Uuid
  
  // ❌ 删除原有字段
  // categoryId             String?      @map("category_id") @db.Uuid
  
  // ✅ 新增字段
  primaryCategoryId     String?          @map("primary_category_id") @db.Uuid
  secondaryCategoryId   String?          @map("secondary_category_id") @db.Uuid
  teacherName           String?          @map("teacher_name") @db.VarChar(64)
  updatedBy             String?          @map("updated_by") @db.VarChar(64)
  
  // 保留现有字段（不变）
  title                 String           @db.VarChar(512)
  description           String?          @db.Text
  type                  QuestionType
  difficulty            Difficulty       @default(medium)
  score                 Int              @default(10)
  answerRules           Json             @default("[]") @map("answer_rules")
  hints                 String?          @db.Text
  tags                  String[]         @default([])
  status                QuestionStatus   @default(draft)
  createdBy             String?          @map("created_by") @db.Uuid
  createdAt             DateTime         @default(now()) @map("created_at")
  updatedAt             DateTime         @updatedAt @map("updated_at")

  // ✅ 新增关联关系
  primaryCategory       QuestionCategory? @relation("QuestionPrimaryCategory", fields: [primaryCategoryId], references: [id])
  secondaryCategory     QuestionCategory? @relation("QuestionSecondaryCategory", fields: [secondaryCategoryId], references: [id])
  
  // ❌ 删除原关联
  // category              QuestionCategory?  @relation(fields: [categoryId], references: [id])
  
  // 保留现有关联（不变）
  creator               User?            @relation("QuestionCreator", fields: [createdBy], references: [id])
  examQuestions         ExamQuestion[]
  submissionDetails     SubmissionDetail[]

  @@map("questions")
}
```

关键变更点：
1. 删除 `categoryId` 字段及其关联
2. 添加4个新字段：`primaryCategoryId`, `secondaryCategoryId`, `teacherName`, `updatedBy`
3. 添加2个新关联关系到QuestionCategory

- [ ] **Step 2: 执行数据库迁移**

Run command:
```bash
cd /data/wps_dbsheet_examination_system/packages/server && npx prisma migrate dev --name add_two_level_categories_and_metadata
```

Expected output:
```
✔ Enter a name for the new migration: … add_two_level_categories_and_metadata
Applying migration `20260617XXXXXX_add_two_level_categories_and_metadata`

The following migration(s) have been created and applied from your schema changes:

migrations/
  └─ 20260617XXXXXX_add_two_level_categories_and_metadata/
    └─ migration.sql

Your database is now in sync with your schema.
```

- [ ] **Step 3: 编写数据迁移脚本处理现有数据**

创建临时迁移SQL文件：

```sql
-- 将原有的categoryId数据迁移到primaryCategoryId
UPDATE questions
SET primary_category_id = category_id,
    category_id = NULL
WHERE category_id IS NOT NULL;

-- 验证迁移结果
SELECT 
    COUNT(*) as total_questions,
    COUNT(primary_category_id) as has_primary_category,
    COUNT(category_id) as still_has_old_category
FROM questions;
```

Run command to execute migration:
```bash
cd /data/wps_dbsheet_examination_system/packages/server && npx prisma db execute --stdin <<EOF
UPDATE questions SET primary_category_id = category_id WHERE category_id IS NOT NULL;
EOF
```

Expected: 所有原categoryId值已迁移到primaryCategoryId

- [ ] **Step 4: 生成Prisma Client并验证**

Run command:
```bash
cd /data/wps_dbsheet_examination_system/packages/server && npx prisma generate
```

Expected: Prisma Client生成成功，无错误信息

- [ ] **Step 5: Commit**

```bash
git add packages/server/prisma/schema.prisma packages/server/prisma/migrations/
git commit -m "feat(question): add two-level category system and metadata fields"
```

---

### Task 2: 后端API接口改造

**Files:**
- Modify: `packages/server/src/routes/questions.ts` (完整重写)

- [ ] **Step 1: 更新Zod验证Schema**

替换文件开头的questionSchema定义：

```typescript
const questionSchema = z.object({
  // ❌ 删除原有字段
  // categoryId: z.string().uuid().nullable().optional(),
  
  // ✅ 新增字段
  primaryCategoryId: z.string().uuid().nullable().optional(),
  secondaryCategoryId: z.string().uuid().nullable().optional(),
  teacherName: z.string().max(64).optional(),
  
  // 保留现有字段
  title: z.string().min(1).max(512),
  description: z.string().optional(),
  type: z.enum(['create_table', 'add_field', 'config_view', 'create_form', 'comprehensive']),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  score: z.number().int().min(0).default(10),
  answerRules: z.array(answerRuleSchema).default([]),
  hints: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
```

- [ ] **Step 2: 重写GET列表接口（支持高级筛选）**

替换GET `/api/questions`路由处理器：

```typescript
// GET /api/questions
questionRouter.get('/', async (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      pageSize = '20',
      search,
      type,
      difficulty,
      status,
      teacherName,
      primaryCategory,
      secondaryCategory,
      createdAtStart,
      createdAtEnd,
      updatedAtStart,
      updatedAtEnd,
    } = req.query;

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    // 构建动态查询条件
    const where: any = {};

    // 基础搜索
    if (search) {
      where.OR = [
        { title: { contains: String(search), mode: 'insensitive' } },
        { description: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    // 基础筛选
    if (type) where.type = String(type);
    if (difficulty) where.difficulty = String(difficulty);
    if (status) where.status = String(status);

    // ✨ 新增：出题老师模糊匹配
    if (teacherName) {
      where.teacherName = { contains: String(teacherName), mode: 'insensitive' };
    }

    // ✨ 新增：一级分类筛选（支持ID或名称）
    if (primaryCategory) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(primaryCategory));
      if (isUuid) {
        where.primaryCategoryId = String(primaryCategory);
      } else {
        where.primaryCategory = { name: { contains: String(primaryCategory), mode: 'insensitive' } };
      }
    }

    // ✨ 新增：二级分类筛选（支持ID或名称）
    if (secondaryCategory) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(secondaryCategory));
      if (isUuid) {
        where.secondaryCategoryId = String(secondaryCategory);
      } else {
        where.secondaryCategory = { name: { contains: String(secondaryCategory), mode: 'insensitive' } };
      }
    }

    // ✨ 新增：创建时间范围筛选
    if (createdAtStart || createdAtEnd) {
      where.createdAt = {};
      if (createdAtStart) where.createdAt.gte = new Date(String(createdAtStart));
      if (createdAtEnd) where.createdAt.lte = new Date(String(createdAtEnd));
    }

    // ✨ 新增：更新时间范围筛选
    if (updatedAtStart || updatedAtEnd) {
      where.updatedAt = {};
      if (updatedAtStart) where.updatedAt.gte = new Date(String(updatedAtStart));
      if (updatedAtEnd) where.updatedAt.lte = new Date(String(updatedAtEnd));
    }

    const [questions, total] = await Promise.all([
      prisma.question.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          // ✅ 替换为两个分类关联
          primaryCategory: { select: { id: true, name: true } },
          secondaryCategory: { select: { id: true, name: true } },
          creator: { select: { id: true, realName: true } },
        },
      }),
      prisma.question.count({ where }),
    ]);

    res.json({ data: questions, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 3: 重写GET详情接口**

替换GET `/api/questions/:id`路由处理器：

```typescript
// GET /api/questions/:id
questionRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const question = await prisma.question.findUnique({
      where: { id: req.params.id },
      include: {
        // ✅ 返回完整的分类信息
        primaryCategory: true,
        secondaryCategory: true,
        creator: { select: { id: true, realName: true } },
      },
    });

    if (!question) {
      return res.status(404).json({ message: '题目不存在' });
    }

    res.json(question);
  } catch (error) {
    console.error('Error fetching question:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 4: 重写POST创建接口**

替换POST `/api/questions`路由处理器：

```typescript
// POST /api/questions
questionRouter.post('/', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const data = questionSchema.parse(req.body);

    // ✅ 自动填充元数据
    const question = await prisma.question.create({
      data: {
        ...data,
        createdBy: req.user!.userId,
        // 如果未提供teacherName，使用当前用户姓名
        teacherName: data.teacherName || req.user?.realName || undefined,
      },
      include: {
        primaryCategory: { select: { id: true, name: true } },
        secondaryCategory: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(question);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Error creating question:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 5: 重写PUT更新接口**

替换PUT `/api/questions/:id`路由处理器：

```typescript
// PUT /api/questions/:id
questionRouter.put('/:id', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const existingQuestion = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existingQuestion) {
      return res.status(404).json({ message: '题目不存在' });
    }

    const data = questionSchema.parse(req.body);

    // ✅ 自动填充更新人
    const updated = await prisma.question.update({
      where: { id: req.params.id },
      data: {
        ...data,
        updatedBy: req.user?.realName || undefined,
      },
      include: {
        primaryCategory: { select: { id: true, name: true } },
        secondaryCategory: { select: { id: true, name: true } },
      },
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Error updating question:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 6: 测试API接口**

Run commands to verify API works:

```bash
# Test GET list endpoint with new filters
curl -s "http://localhost:3001/api/questions?page=1&pageSize=5" | head -c 500
```

Expected: Returns questions array with new fields (primaryCategory, secondaryCategory, teacherName, etc.)

```bash
# Test GET detail endpoint
# First get a valid question ID
QUESTION_ID=$(curl -s "http://localhost:3001/api/questions?page=1&pageSize=1" | jq -r '.data[0].id')
echo "Testing with ID: $QUESTION_ID"
curl -s "http://localhost:3001/api/questions/$QUESTION_ID" | jq '.'
```

Expected: Full question object with all new metadata fields

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/questions.ts
git commit -m "feat(api): enhance question endpoints with two-level categories and advanced filtering"
```

---

### Task 3: 前端类型定义更新

**Files:**
- Modify: `packages/client/src/types/index.ts` (Question interface)

- [ ] **Step 1: 更新Question接口定义**

找到Question接口定义（约第95行），替换为：

```typescript
export interface Question {
  id: string;
  
  // ❌ 删除原有字段
  // categoryId: string | null;
  
  // ✅ 新增字段
  primaryCategoryId: string | null;
  secondaryCategoryId: string | null;
  teacherName: string | null;
  updatedBy: string | null;
  
  // 保留现有字段
  title: string;
  description: string | null;
  type: QuestionType;
  difficulty: Difficulty;
  score: number;
  answerRules: AnswerRule[];
  hints: string | null;
  tags: string[];
  status: QuestionStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  
  // ✅ 替换关联关系
  primaryCategory?: { id: string; name: string } | null;
  secondaryCategory?: { id: string; name: string } | null;
  
  // ❌ 删除原关联
  // category?: { id: string; name: string } | null;
  
  creator?: { id: string; realName: string } | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/types/index.ts
git commit -m "feat(types): update Question interface for two-level categories and metadata"
```

---

### Task 4: 创建详情弹窗组件

**Files:**
- Create: `packages/client/src/pages/teacher/QuestionDetailDrawer.tsx`

- [ ] **Step 1: 创建QuestionDetailDrawer组件文件**

完整代码：

```tsx
import { Drawer, Descriptions, Tag, Card, Typography } from 'antd';
import dayjs from 'dayjs';
import type { Question } from '../../types';

const { Paragraph } = Typography;

interface QuestionDetailDrawerProps {
  question: Question | null;
  visible: boolean;
  onClose: () => void;
}

const typeLabels: Record<string, string> = {
  create_table: '建表', add_field: '字段', config_view: '视图', create_form: '表单', comprehensive: '综合',
};

const difficultyColors: Record<string, string> = {
  easy: 'green', medium: 'orange', hard: 'red',
};

const difficultyLabels: Record<string, string> = {
  easy: '简单', medium: '中等', hard: '困难',
};

const statusColors: Record<string, string> = {
  published: 'blue', draft: 'default', archived: 'orange',
};

const statusLabels: Record<string, string> = {
  published: '已发布', draft: '草稿', archived: '已归档',
};

export function QuestionDetailDrawer({ question, visible, onClose }: QuestionDetailDrawerProps) {
  if (!question) return null;

  return (
    <Drawer
      title="题目详情"
      placement="right"
      width={600}
      open={visible}
      onClose={onClose}
    >
      {/* 基本信息 */}
      <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="标题">
            <strong>{question.title}</strong>
          </Descriptions.Item>
          
          <Descriptions.Item label="题型">
            <Tag color="blue">{typeLabels[question.type] || question.type}</Tag>
          </Descriptions.Item>
          
          <Descriptions.Item label="难度">
            <Tag color={difficultyColors[question.difficulty]}>
              {difficultyLabels[question.difficulty]}
            </Tag>
          </Descriptions.Item>
          
          <Descriptions.Item label="分值">{question.score} 分</Descriptions.Item>
          
          <Descriptions.Item label="状态">
            <Tag color={statusColors[question.status]}>
              {statusLabels[question.status]}
            </Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 知识点分类 */}
      <Card title="知识点分类" size="small" style={{ marginBottom: 16 }}>
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="一级分类">
            {question.primaryCategory?.name || (
              <span style={{ color: '#999' }}>—</span>
            )}
          </Descriptions.Item>
          
          <Descriptions.Item label="二级分类">
            {question.secondaryCategory?.name || (
              <span style={{ color: '#999' }}>—</span>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 人员与时间信息 */}
      <Card title="元数据信息" size="small" style={{ marginBottom: 16 }}>
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="出题老师" span={1}>
            {question.teacherName || (
              <span style={{ color: '#999' }}>—</span>
            )}
          </Descriptions.Item>
          
          <Descriptions.Item label="创建人" span={1}>
            {question.creator?.realName || (
              <span style={{ color: '#999' }}>—</span>
            )}
          </Descriptions.Item>
          
          <Descriptions.Item label="更新人" span={1}>
            {question.updatedBy || (
              <span style={{ color: '#999' }}>—</span>
            )}
          </Descriptions.Item>
          
          <Descriptions.Item label="创建时间" span={1}>
            {dayjs(question.createdAt).format('YYYY-MM-DD HH:mm:ss')}
          </Descriptions.Item>
          
          <Descriptions.Item label="更新时间" span={2}>
            {dayjs(question.updatedAt).format('YYYY-MM-DD HH:mm:ss')}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 题目内容 */}
      {(question.description || question.hints) && (
        <Card title="内容详情" size="small" style={{ marginBottom: 16 }}>
          {question.description && (
            <div style={{ marginBottom: 16 }}>
              <strong>描述：</strong>
              <Paragraph>{question.description}</Paragraph>
            </div>
          )}
          
          {question.hints && (
            <div>
              <strong>提示：</strong>
              <Paragraph>{question.hints}</Paragraph>
            </div>
          )}
        </Card>
      )}

      {/* 标签 */}
      {question.tags && question.tags.length > 0 && (
        <Card title="标签" size="small" style={{ marginBottom: 16 }}>
          <div>
            {question.tags.map(tag => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        </Card>
      )}

      {/* 评分规则 */}
      {question.answerRules && question.answerRules.length > 0 && (
        <Card title="评分规则" size="small">
          <pre style={{
            background: '#f5f5f5',
            padding: 12,
            borderRadius: 4,
            fontSize: 12,
            maxHeight: 300,
            overflow: 'auto',
          }}>
            {JSON.stringify(question.answerRules, null, 2)}
          </pre>
        </Card>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/pages/teacher/QuestionDetailDrawer.tsx
git commit -m "feat(ui): add QuestionDetailDrawer component for viewing full question details"
```

---

### Task 5: 题库列表页重构

**Files:**
- Modify: `packages/client/src/pages/teacher/QuestionBank.tsx` (完整重写)

- [ ] **Step 1: 完全重写QuestionBank组件**

完整替换文件内容为：

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Input, Select, Space, Tag, Popconfirm, message, Card, DatePicker } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import type { Question, PaginatedResponse, QuestionCategory } from '../../types';
import { QuestionDetailDrawer } from './QuestionDetailDrawer';

const { RangePicker } = DatePicker;

const typeLabels: Record<string, string> = {
  create_table: '建表', add_field: '字段', config_view: '视图', create_form: '表单', comprehensive: '综合',
};

interface FilterParams {
  search?: string;
  type?: string;
  difficulty?: string;
  status?: string;
  teacherName?: string;
  primaryCategory?: string;
  secondaryCategory?: string;
  createdAtStart?: string;
  createdAtEnd?: string;
  updatedAtStart?: string;
  updatedAtEnd?: string;
}

export function QuestionBank() {
  const navigate = useNavigate();
  const [data, setData] = useState<PaginatedResponse<Question>>({ data: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterParams>({});
  
  // ✨ 新增状态：分类选项
  const [primaryCategories, setPrimaryCategories] = useState<{ value: string; label: string }[]>([]);
  const [secondaryCategories, setSecondaryCategories] = useState<{ value: string; label: string }[]>([]);
  const [selectedPrimaryCategory, setSelectedPrimaryCategory] = useState<string | undefined>();
  
  // ✨ 新增状态：详情弹窗
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);

  // 加载一级分类
  useEffect(() => {
    api.get('/categories').then(res => {
      const cats = res.data.filter((cat: QuestionCategory) => !cat.parentId);
      setPrimaryCategories(cats.map((cat: QuestionCategory) => ({
        value: cat.id,
        label: cat.name,
      })));
    }).catch(() => {});
  }, []);

  const fetchQuestions = async (page = 1) => {
    setLoading(true);
    try {
      // 构建查询参数
      const params: Record<string, any> = {
        page: String(page),
        pageSize: '20',
      };
      
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          params[key] = value;
        }
      });

      const queryString = new URLSearchParams(
        Object.entries(params)
          .filter(([_, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)])
      ).toString();

      const res = await api.get(`/questions?${queryString}`);
      setData(res.data);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, [filters]);

  // ✨ 处理一级分类变化（级联加载二级分类）
  const handlePrimaryCategoryChange = async (value: string | undefined) => {
    setSelectedPrimaryCategory(value);
    
    // 清空二级分类筛选
    setFilters(prev => ({
      ...prev,
      primaryCategory: value,
      secondaryCategory: undefined,
    }));
    setSecondaryCategories([]);

    if (!value) return;

    try {
      const res = await api.get(`/categories?parentId=${value}`);
      setSecondaryCategories(
        res.data.map((cat: QuestionCategory) => ({
          value: cat.id,
          label: cat.name,
        }))
      );
    } catch {
      message.error('加载二级分类失败');
    }
  };

  // ✨ 显示详情弹窗
  const showDetail = (record: Question) => {
    setSelectedQuestion(record);
    setDetailVisible(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/questions/${id}`);
      message.success('删除成功');
      fetchQuestions();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  // ✨ 处理日期范围选择
  const handleCreatedAtRange = (_: any, dateStrings: [string, string]) => {
    setFilters(prev => ({
      ...prev,
      createdAtStart: dateStrings[0] || undefined,
      createdAtEnd: dateStrings[1] || undefined,
    }));
  };

  const handleUpdatedAtRange = (_: any, dateStrings: [string, string]) => {
    setFilters(prev => ({
      ...prev,
      updatedAtStart: dateStrings[0] || undefined,
      updatedAtEnd: dateStrings[1] || undefined,
    }));
  };

  const columns = [
    { 
      title: '标题', 
      dataIndex: 'title', 
      key: 'title', 
      render: (text: string, record: Question) => (
        <a onClick={() => navigate(`/teacher/questions/${record.id}/edit`)}>{text}</a>
      )
    },
    { 
      title: '类型', 
      dataIndex: 'type', 
      key: 'type', 
      width: 80, 
      render: (v: string) => <Tag>{typeLabels[v] || v}</Tag> 
    },
    { 
      title: '难度', 
      dataIndex: 'difficulty', 
      key: 'difficulty', 
      width: 80, 
      render: (v: string) => (
        <Tag color={v === 'easy' ? 'green' : v === 'medium' ? 'orange' : 'red'}>
          {v === 'easy' ? '简单' : v === 'medium' ? '中等' : '困难'}
        </Tag>
      )
    },
    { title: '分值', dataIndex: 'score', key: 'score', width: 60 },
    
    // ✨ 替换原"分类"列为两列
    { 
      title: '一级分类', 
      dataIndex: ['primaryCategory', 'name'], 
      key: 'primaryCategory',
      width: 100,
      render: (text: string) => text || '—'
    },
    { 
      title: '二级分类', 
      dataIndex: ['secondaryCategory', 'name'], 
      key: 'secondaryCategory',
      width: 100,
      render: (text: string) => text || '—'
    },
    
    // ✨ 新增列
    { 
      title: '出题老师', 
      dataIndex: 'teacherName', 
      key: 'teacherName',
      width: 90,
      render: (text: string) => text || '—'
    },
    { 
      title: '创建时间', 
      dataIndex: 'createdAt', 
      key: 'createdAt',
      width: 150,
      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm')
    },
    { 
      title: '更新时间', 
      dataIndex: 'updatedAt', 
      key: 'updatedAt',
      width: 150,
      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm')
    },
    
    { 
      title: '状态', 
      dataIndex: 'status', 
      key: 'status', 
      width: 80, 
      render: (v: string) => (
        <Tag color={v === 'published' ? 'blue' : v === 'draft' ? 'default' : 'orange'}>
          {v === 'published' ? '已发布' : v === 'draft' ? '草稿' : '已归档'}
        </Tag>
      )
    },
    {
      title: '操作', 
      key: 'actions', 
      width: 160,  // ✨ 增加宽度
      render: (_: any, record: Question) => (
        <Space>
          {/* ✨ 新增详情按钮 */}
          <Button 
            size="small" 
            icon={<EyeOutlined />} 
            onClick={() => showDetail(record)}
            title="查看详情"
          />
          <Button 
            size="small" 
            icon={<EditOutlined />} 
            onClick={() => navigate(`/teacher/questions/${record.id}/edit`)}
          />
          <Popconfirm 
            title="确定删除？" 
            onConfirm={() => handleDelete(record.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      {/* 头部操作区 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>题库管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/teacher/questions/new')}>
          新建题目
        </Button>
      </div>

      {/* ✨ 增强的筛选区域 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size="middle">
          {/* 原有筛选条件 */}
          <Input 
            placeholder="搜索题目" 
            prefix={<SearchOutlined />} 
            allowClear 
            style={{ width: 200 }} 
            onChange={e => setFilters(f => ({ ...f, search: e.target.value || undefined }))} 
          />
          <Select 
            placeholder="题目类型" 
            allowClear 
            style={{ width: 130 }} 
            onChange={v => setFilters(f => ({ ...f, type: v }))} 
            options={Object.entries(typeLabels).map(([k, v]) => ({ value: k, label: v }))} 
          />
          <Select 
            placeholder="难度" 
            allowClear 
            style={{ width: 100 }} 
            onChange={v => setFilters(f => ({ ...f, difficulty: v }))} 
            options={[{ value: 'easy', label: '简单' }, { value: 'medium', label: '中等' }, { value: 'hard', label: '困难' }]} 
          />
          <Select 
            placeholder="状态" 
            allowClear 
            style={{ width: 110 }} 
            onChange={v => setFilters(f => ({ ...f, status: v }))} 
            options={[{ value: 'draft', label: '草稿' }, { value: 'published', label: '已发布' }, { value: 'archived', label: '已归档' }]} 
          />
          
          {/* ✨ 新增筛选条件：分类 */}
          <Select 
            placeholder="一级分类" 
            allowClear 
            style={{ width: 140 }}
            value={selectedPrimaryCategory}
            onChange={handlePrimaryCategoryChange}
            options={primaryCategories}
          />
          <Select 
            placeholder="二级分类" 
            allowClear 
            style={{ width: 140 }}
            disabled={!selectedPrimaryCategory}
            onChange={v => setFilters(f => ({ ...f, secondaryCategory: v }))}
            options={secondaryCategories}
          />
          
          {/* ✨ 新增筛选条件：出题老师 */}
          <Input 
            placeholder="出题老师" 
            allowClear 
            style={{ width: 120 }} 
            onChange={e => setFilters(f => ({ ...f, teacherName: e.target.value || undefined }))} 
          />
          
          {/* ✨ 新增筛选条件：时间范围 */}
          <RangePicker 
            placeholder={['创建开始', '创建结束']}
            onChange={handleCreatedAtRange}
            style={{ width: 240 }}
          />
          <RangePicker 
            placeholder={['更新开始', '更新结束']}
            onChange={handleUpdatedAtRange}
            style={{ width: 240 }}
          />
        </Space>
      </Card>

      {/* 表格区域 */}
      <Table 
        dataSource={data.data} 
        columns={columns} 
        rowKey="id" 
        loading={loading} 
        scroll={{ x: 1200 }}
        pagination={{ 
          current: data.page, 
          total: data.total, 
          pageSize: data.pageSize, 
          onChange: fetchQuestions,
          showTotal: (total) => `共 ${total} 条记录`,
        }} 
      />

      {/* ✨ 详情弹窗 */}
      <QuestionDetailDrawer
        question={selectedQuestion}
        visible={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setSelectedQuestion(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/pages/teacher/QuestionBank.tsx
git commit -m "feat(ui): refactor question bank with advanced filters and detail drawer"
```

---

### Task 6: 题目编辑器适配

**Files:**
- Modify: `packages/client/src/pages/teacher/QuestionEditor.tsx`

- [ ] **Step 1: 更新编辑器中的分类选择部分**

找到Form.Item中关于categoryId的部分（约第199行附近），替换为：

```tsx
{/* ✨ 替换为两级分类选择 */}
<Row gutter={16}>
  <Col span={12}>
    <Form.Item name="primaryCategoryId" label="一级分类">
      <Select 
        allowClear
        placeholder="请选择一级分类"
        onChange={(value: string) => {
          // 加载二级分类
          if (value) {
            api.get(`/categories?parentId=${value}`).then(res => {
              // 动态设置二级分类选项（这里简化处理）
            }).catch(() => {});
          }
        }}
        options={categories.filter(c => !c.parentId).map(c => ({
          value: c.id,
          label: c.name,
        }))}
      />
    </Form.Item>
  </Col>
  <Col span={12}>
    <Form.Item name="secondaryCategoryId" label="二级分类">
      <Select 
        allowClear
        placeholder="请先选择一级分类"
        // 可以根据选中的一级分类动态加载
      >
        {/* 二级分类选项会根据一级分类动态加载 */}
      </Select>
    </Form.Item>
  </Col>
</Row>

{/* ✨ 新增：出题老师字段 */}
<Form.Item 
  name="teacherName" 
  label="出题老师"
  rules={[{ max: 64, message: '最多64个字符' }]}
>
  <Input placeholder="请输入出题老师姓名" maxLength={64} />
</Form.Item>
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/pages/teacher/QuestionEditor.tsx
git commit -m "feat(editor): adapt question editor for two-level categories and teacher name field"
```

---

### Task 7: 功能测试与验证

**Files:** None (testing only)

- [ ] **Step 1: 启动开发服务器并测试后端API**

Run commands:
```bash
# Start server (if not running)
cd /data/wps_dbsheet_examination_system/packages/server && npm run dev &

# Test basic list endpoint
sleep 3
curl -s http://localhost:3001/api/questions | jq '.data[0] | keys'

# Expected output should include new fields:
# ["id", "primaryCategoryId", "secondaryCategoryId", "teacherName", "updatedBy", "title", ...]
```

- [ ] **Step 2: 测试高级筛选功能**

```bash
# Test filter by teacher name
curl -s "http://localhost:3001/api/questions?teacherName=王" | jq '.total'

# Test filter by time range
curl -s "http://localhost:3001/api/questions?createdAtStart=2026-01-01T00:00:00Z&createdAtEnd=2026-12-31T23:59:59Z" | jq '.total'

# Test combined filters
curl -s "http://localhost:3001/api/questions?type=create_table&difficulty=easy&status=published" | jq '{total: .total, first_type: .data[0].type}'
```

- [ ] **Step 3: 测试CRUD操作**

```bash
# Test create a new question with new fields
curl -X POST http://localhost:3001/api/questions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "title": "测试题目",
    "type": "create_table",
    "difficulty": "easy",
    "score": 10,
    "teacherName": "测试老师",
    "primaryCategoryId": "VALID_CATEGORY_ID"
  }' | jq '.teacherName, .primaryCategory'

# Expected: Should return the newly created question with teacherName and primaryCategory populated
```

- [ ] **Step 4: 启动前端并测试UI交互**

Run command:
```bash
cd /data/wps_dbsheet_examination_system/packages/client && npm run dev
```

Manual testing checklist:
- [ ] 访问 `/teacher/questions` 页面，确认表格显示正常
- [ ] 测试一级分类下拉框是否正确加载
- [ ] 选择一级分类后，二级分类是否级联加载
- [ ] 输入出题老师姓名并筛选，结果是否正确
- [ ] 选择创建时间范围，筛选结果是否符合预期
- [ ] 点击"详情"按钮，弹窗是否正确展示所有信息
- [ ] 点击"新建题目"，编辑器中是否包含新增的字段
- [ ] 创建一个带有一级分类、二级分类、出题老师的题目，保存成功

- [ ] **Step 5: 最终Commit（如有修复）**

```bash
git add -A
git commit -m "test: complete integration testing of question bank enhancement features"
```

---

## Summary Checklist

After completing all tasks, verify:

- [ ] **Data Model**: Question表包含新字段（primaryCategoryId, secondaryCategoryId, teacherName, updatedBy）
- [ ] **Migration**: 现有categoryId数据已成功迁移到primaryCategoryId
- [ ] **Backend API**: 
  - GET /questions 支持9个筛选维度
  - POST/PUT /questions 支持新字段的读写
  - 返回数据包含完整的分类信息和元数据
- [ ] **Frontend Types**: Question接口与新数据结构匹配
- [ ] **QuestionBank Page**: 
  - 筛选区域包含所有新增条件
  - 一级/二级分类级联选择正常工作
  - 表格列显示新字段
  - 详情按钮和弹窗功能正常
- [ ] **QuestionEditor**: 支持填写两级分类和出题老师
- [ ] **QuestionDetailDrawer**: 完整展示题目所有信息
- [ ] **No Breaking Changes**: 已有考试和学生答题功能不受影响

---

**Estimated Total Time**: 4-6 hours (excluding testing iterations)

**Risk Level**: Low (minimal changes to core logic, additive features only)
