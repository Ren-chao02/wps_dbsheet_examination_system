# 多维表格实操题库系统设计文档

**文档版本**: 1.0  
**创建日期**: 2026-06-17  
**状态**: 已批准 ✅  
**作者**: AI Assistant  

---

## 一、项目概述

### 1.1 背景

基于WPS多维表格官方教程，为WPS实训室系统设计和实现一套完整的实操题库管理系统。该系统支持：
- 实操类型题目的创建和管理
- 两级知识点分类体系
- 增强的题目属性（出题老师、更新人、时间戳等）
- 高级筛选和详情查看功能

### 1.2 目标

1. **数据结构优化**: 删除原有单一分类字段，改为两级分类体系
2. **属性增强**: 新增出题老师、更新人、创建/更新时间等元数据
3. **功能扩展**: 增加题目详情查看功能
4. **筛选增强**: 支持多条件组合查询（分类、老师、时间范围等）
5. **向后兼容**: 平滑迁移现有数据，不影响已发布的考试

### 1.3 范围

**包含：**
- Question 数据模型改造
- QuestionCategory 分类体系优化
- 后端 CRUD API 调整
- 前端题库列表页重构
- 详情弹窗组件开发
- 筛选功能增强

**不包含：**
- 考试模块改动
- 学生端界面调整
- 权限系统修改

---

## 二、技术架构

### 2.1 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React + TypeScript | 18.x |
| UI 组件库 | Ant Design | 5.x |
| 状态管理 | Zustand | - |
| 后端框架 | Express + TypeScript | 4.x |
| ORM | Prisma | 5.x |
| 数据库 | PostgreSQL | 15+ |

### 2.2 涉及文件清单

#### 后端文件
```
packages/server/
├── prisma/schema.prisma                    # 数据模型定义
├── prisma/migrations/                       # 数据库迁移脚本
├── src/routes/questions.ts                  # 题目API路由
├── src/routes/categories.ts                 # 分类API路由
└── src/__tests__/                           # 单元测试（可选）
```

#### 前端文件
```
packages/client/src/
├── pages/teacher/
│   ├── QuestionBank.tsx                     # 题库列表页（重构）
│   ├── QuestionEditor.tsx                   # 题目编辑器（微调）
│   └── QuestionDetailDrawer.tsx             # 详情弹窗（新增）
├── types/index.ts                           # 类型定义（更新）
└── services/api.ts                          # API服务（可能需要调整）
```

---

## 三、详细设计

### 3.1 数据模型设计

#### 3.1.1 Question 模型变更

```prisma
model Question {
  id                    String           @id @default(uuid()) @db.Uuid
  
  // ❌ 删除字段
  // categoryId             String?      @map("category_id") @db.Uuid
  
  // ✅ 新增字段
  primaryCategoryId     String?          @map("primary_category_id") @db.Uuid
  secondaryCategoryId   String?          @map("secondary_category_id") @db.Uuid
  teacherName           String?          @map("teacher_name") @db.VarChar(64)
  updatedBy             String?          @map("updated_by") @db.VarChar(64)
  
  // 保留现有字段
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
  
  // 保留现有关联
  creator               User?            @relation("QuestionCreator", fields: [createdBy], references: [id])
  examQuestions         ExamQuestion[]
  submissionDetails     SubmissionDetail[]

  @@map("questions")
}
```

**变更说明：**

| 操作 | 字段名 | 类型 | 说明 |
|------|--------|------|------|
| ❌ 删除 | `categoryId` | UUID | 原单一分类ID |
| ✅ 新增 | `primaryCategoryId` | UUID | 一级分类ID |
| ✅ 新增 | `secondaryCategoryId` | UUID | 二级分类ID（可选） |
| ✅ 新增 | `teacherName` | VARCHAR(64) | 出题老师姓名 |
| ✅ 新增 | `updatedBy` | VARCHAR(64) | 最后更新人姓名 |

#### 3.1.2 QuestionCategory 模型（保持不变）

```prisma
model QuestionCategory {
  id        String    @id @default(uuid()) @db.Uuid
  name      String    @db.VarChar(128)
  parentId  String?   @map("parent_id") @db.Uuid
  sortOrder Int       @default(0) @map("sort_order")
  createdAt DateTime  @default(now()) @map("created_at")

  parent    QuestionCategory?  @relation("CategoryTree", fields: [parentId], references: [id])
  children  QuestionCategory[] @relation("CategoryTree")
  questions Question[]        // 需要调整关联

  @@map("question_categories")
}
```

**注意**: 由于一个题目现在可以同时关联一级和二级分类，需要在Question模型中定义两个独立的关系。

### 3.2 知识点分类体系设计

#### 3.2.1 分类层级结构

采用两级树形结构：

```
根节点
├── 📚 基础操作 (cat-basic)
│   ├── 创建表格 (sub-create-table)
│   ├── 导入数据 (sub-import-data)
│   └── 记录管理 (sub-record-mgmt)
│
├── 🔧 字段管理 (cat-field)
│   ├── 添加字段 (sub-add-field)
│   ├── 字段类型应用 (sub-field-types)
│   └── 字段配置 (sub-field-config)
│
├── 👁️ 视图配置 (cat-view)
│   ├── 表格视图 (sub-table-view)
│   ├── 看板视图 (sub-kanban-view)
│   ├── 日历视图 (sub-calendar-view)
│   └── 甘特图视图 (sub-gantt-view)
│
├── 📝 表单应用 (cat-form)
│   ├── 创建收集表 (sub-create-form)
│   ├── 表单配置 (sub-form-config)
│   └── 数据收集 (sub-data-collection)
│
└── ⚡ 高级功能 (cat-advanced)
    ├── 关联字段 (sub-relation-field)
    ├── 公式计算 (sub-formula-calc)
    ├── 统计汇总 (sub-statistics)
    └── 自动化流程 (sub-automation)
```

#### 3.2.2 预置分类数据

系统将预置5个一级分类和20个二级分类，学校可根据需要自定义扩展。

### 3.3 API 接口设计

#### 3.3.1 题目列表接口（GET /api/questions）

**请求参数：**

```typescript
interface GetQuestionsParams {
  page?: number;                    // 页码，默认1
  pageSize?: number;                // 每页数量，默认20
  
  // 基础筛选条件
  search?: string;                  // 标题搜索关键词
  type?: QuestionType;              // 题目类型
  difficulty?: Difficulty;          // 难度等级
  status?: QuestionStatus;          // 状态
  
  // ✨ 新增筛选条件
  teacherName?: string;             // 出题老师（模糊匹配）
  primaryCategory?: string;         // 一级分类名称或ID
  secondaryCategory?: string;       // 二级分类名称或ID
  createdAtStart?: string;          // 创建时间起始（ISO格式）
  createdAtEnd?: string;            // 创建时间结束
  updatedAtStart?: string;          // 更新时间起始
  updatedAtEnd?: string;            // 更新时间结束
}
```

**响应格式：**

```typescript
interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface Question {
  id: string;
  title: string;
  type: QuestionType;
  difficulty: Difficulty;
  score: number;
  status: QuestionStatus;
  
  // ✨ 新增字段
  primaryCategory?: {
    id: string;
    name: string;
  };
  secondaryCategory?: {
    id: string;
    name: string;
  };
  teacherName?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  
  // 保留字段
  tags: string[];
  creator?: { id: string; name: string };
}
```

#### 3.3.2 题目详情接口（GET /api/questions/:id）

返回完整题目信息，包括所有新增字段。

#### 3.3.3 创建题目接口（POST /api/questions）

**请求体：**

```typescript
interface CreateQuestionDTO {
  title: string;
  description?: string;
  type: QuestionType;
  difficulty?: Difficulty;
  score?: number;
  answerRules?: any[];
  hints?: string;
  tags?: string[];
  
  // ✨ 新增字段
  primaryCategoryId?: string;       // 一级分类ID
  secondaryCategoryId?: string;     // 二级分类ID
  teacherName: string;              // 出题老师（必填）
}
```

**自动填充字段：**
- `createdBy`: 当前登录用户ID
- `createdAt`: 当前时间戳
- `updatedAt`: 当前时间戳

#### 3.3.4 更新题目接口（PUT /api/questions/:id)

**请求体：** 同CreateQuestionDTO，额外增加：

```typescript
interface UpdateQuestionDTO extends CreateQuestionDTO {
  // ✨ 自动填充
  updatedBy: string;                // 当前登录用户姓名
}
```

#### 3.3.5 分类接口调整

**获取一级分类列表（GET /api/question-categories）**

```typescript
// 不传parentId或parentId=null时，返回所有一级分类
GET /api/question-categories?parentId=
```

**获取二级分类列表（GET /api/question-categories）**

```typescript
// 传入一级分类ID，返回其下的二级分类
GET /api/question-categories?parentId={primaryCategoryId}
```

### 3.4 前端UI设计

#### 3.4.1 题库列表页布局

```
┌─────────────────────────────────────────────────────────────┐
│  题库管理                              [+ 新建题目]         │
├─────────────────────────────────────────────────────────────┤
│  ┌─ 筛选区域 ─────────────────────────────────────────────┐ │
│  │ [🔍 搜索] [题型▼] [难度▼] [状态▼]                      │ │
│  │ [一级分类▼] [二级分类▼] [出题老师]                     │ │
│  │ [创建时间 ~ ] [更新时间 ~ ]                             │ │
│  └────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  ┌─ 表格区域 ─────────────────────────────────────────────┐ │
│  │ 标题 │ 类型 │ 难度 │ 分值 │ 一级分类 │ 二级分类 │ ...   │ │
│  │ ─────┼──────┼──────┼──────┼─────────┼─────────┼────    │ │
│  │ ...  │ ...  │ ...  │ ...  │ ...     │ ...     │ ...    │ │
│  └────────────────────────────────────────────────────────┘ │
│  共 XX 条记录  < 1 2 3 4 5 >                                │
└─────────────────────────────────────────────────────────────┘
```

#### 3.4.2 表格列定义

| 序号 | 列名 | 字段路径 | 宽度 | 渲染方式 |
|------|------|---------|------|----------|
| 1 | 标题 | `title` | 自适应 | 可点击跳转编辑 |
| 2 | 类型 | `type` | 80px | Tag标签 |
| 3 | 难度 | `difficulty` | 80px | 彩色Tag |
| 4 | 分值 | `score` | 60px | 数字 |
| 5 | **一级分类** | `primaryCategory.name` | 100px | 文本（无则显示"—"）|
| 6 | **二级分类** | `secondaryCategory.name` | 100px | 文本（无则显示"—"）|
| 7 | **出题老师** | `teacherName` | 90px | 文本 |
| 8 | **创建时间** | `createdAt` | 150px | 格式化日期 |
| 9 | **更新时间** | `updatedAt` | 150px | 格式化日期 |
| 10 | 状态 | `status` | 80px | Tag标签 |
| 11 | **操作** | - | 160px | [详情] [编辑] [删除] |

#### 3.4.3 详情弹窗设计

使用 Ant Design 的 Drawer 组件实现侧边栏详情展示。

**展示内容：**

1. **基本信息区**
   - 标题、题型、难度、分值、状态
   
2. **分类信息区**
   - 一级分类、二级分类
   
3. **人员信息区**
   - 出题老师、创建人、更新人
   
4. **时间信息区**
   - 创建时间、更新时间
   
5. **内容区**
   - 题目描述、提示信息
   
6. **标签区**
   - 所有标签的Tag展示
   
7. **评分规则区**
   - JSON格式的answerRules展示

### 3.5 筛选功能设计

#### 3.5.1 多条件组合查询

后端使用 Prisma 的动态 Where 条件构建：

```typescript
const buildWhereClause = (filters: FilterParams): Prisma.QuestionWhereInput => {
  const where: Prisma.QuestionWhereInput = {};
  
  // 基础条件
  if (filters.search) where.title = { contains: filters.search, mode: 'insensitive' };
  if (filters.type) where.type = filters.type;
  if (filters.difficulty) where.difficulty = filters.difficulty;
  if (filters.status) where.status = filters.status;
  
  // 新增条件
  if (filters.teacherName) {
    where.teacherName = { contains: filters.teacherName, mode: 'insensitive' };
  }
  
  if (filters.primaryCategory) {
    // 支持按ID或名称查询
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters.primaryCategory);
    if (isUuid) {
      where.primaryCategoryId = filters.primaryCategory;
    } else {
      where.primaryCategory = { name: { contains: filters.primaryCategory, mode: 'insensitive' } };
    }
  }
  
  if (filters.secondaryCategory) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters.secondaryCategory);
    if (isUuid) {
      where.secondaryCategoryId = filters.secondaryCategory;
    } else {
      where.secondaryCategory = { name: { contains: filters.secondaryCategory, mode: 'insensitive' } };
    }
  }
  
  // 时间范围
  if (filters.createdAtStart || filters.createdAtEnd) {
    where.createdAt = {};
    if (filters.createdAtStart) where.createdAt.gte = new Date(filters.createdAtStart);
    if (filters.createdAtEnd) where.createdAt.lte = new Date(filters.createdAtEnd);
  }
  
  if (filters.updatedAtStart || filters.updatedAtEnd) {
    where.updatedAt = {};
    if (filters.updatedAtStart) where.updatedAt.gte = new Date(filters.updatedAtStart);
    if (filters.updatedAtEnd) where.updatedAt.lte = new Date(filters.updatedAtEnd);
  }
  
  return where;
};
```

#### 3.5.2 级联选择逻辑

当用户选择一级分类后，动态加载对应的二级分类选项：

```typescript
// React 组件中的处理逻辑
const handlePrimaryCategoryChange = async (value: string | undefined) => {
  // 清空二级分类
  form.setFieldsValue({ secondaryCategory: undefined });
  setSecondaryCategories([]);
  
  if (!value) return;
  
  try {
    // 加载该一级分类下的二级分类
    const res = await api.get('/question-categories', { params: { parentId: value } });
    setSecondaryCategories(
      res.data.map((cat: QuestionCategory) => ({
        value: cat.id,
        label: cat.name
      }))
    );
  } catch (error) {
    message.error('加载二级分类失败');
  }
};
```

---

## 四、实施计划

### 4.1 任务分解与优先级

#### P0 - 必须完成（核心功能）

| 任务编号 | 任务描述 | 工作量 | 依赖项 |
|---------|---------|--------|--------|
| T01 | Prisma Schema修改 | 2h | 无 |
| T02 | 数据库迁移脚本编写 | 1h | T01 |
| T03 | 迁移现有categoryId数据 | 0.5h | T02 |
| T04 | 后端CRUD接口调整 | 4h | T02 |
| T05 | 前端类型定义更新 | 1h | T04 |
| T06 | 题库列表页重构 | 4h | T05 |
| T07 | 详情弹窗开发 | 2h | T06 |

**P0小计：约14.5小时（~2个工作日）**

#### P1 - 应该完成（增强功能）

| 任务编号 | 任务描述 | 工作量 | 依赖项 |
|---------|---------|--------|--------|
| T08 | 高级筛选功能实现 | 3h | T06 |
| T09 | 分类级联选择 | 2h | T08 |
| T10 | 题目编辑器适配 | 2h | T04 |

**P1小计：约7小时（~1个工作日）**

#### P2 - 可以完成（锦上添花）

| 任务编号 | 任务描述 | 工作量 | 依赖项 |
|---------|---------|--------|--------|
| T11 | 预置分类数据导入 | 1h | T02 |
| T12 | 单元测试编写 | 3h | T04-T07 |
| T13 | 用户文档更新 | 2h | 全部完成 |

**P2小计：约6小时（~1个工作日）**

### 4.2 总体时间估算

- **最小可用版本（MVP）**: P0任务 = **2个工作日**
- **完整版本**: P0 + P1 = **3个工作日**
- **生产就绪版本**: P0 + P1 + P2 = **4个工作日**

### 4.3 风险评估与应对

| 风险项 | 可能性 | 影响 | 应对措施 |
|--------|--------|------|----------|
| 现有数据迁移失败 | 中 | 高 | 提前备份，准备回滚脚本 |
| 前端兼容性问题 | 低 | 中 | 保持原有接口签名不变 |
| 性能问题（多条件查询） | 低 | 中 | 添加数据库索引 |
| 用户接受度 | 中 | 中 | 提供培训文档和示例数据 |

---

## 五、测试策略

### 5.1 单元测试覆盖

**后端测试重点：**
- Prisma查询构建的正确性
- 数据验证逻辑（Zod schema）
- 权限检查

**前端测试重点：**
- 筛选组件的状态管理
- 级联选择的联动逻辑
- 详情弹窗的数据展示

### 5.2 集成测试场景

1. **数据完整性测试**
   - 创建带有一级和二级分类的题目
   - 只有一级分类的题目
   - 无分类的题目

2. **筛选功能测试**
   - 单条件筛选
   - 多条件组合筛选
   - 时间范围筛选
   - 模糊匹配（老师姓名）

3. **边界情况测试**
   - 空值处理
   - 特殊字符
   - 超长文本
   - 并发操作

### 5.3 回归测试

确保以下功能不受影响：
- 已有考试的题目引用
- 学生的答题提交
- 成绩统计报表

---

## 六、附录

### 附录A：题目样例数据

详见第七章提供的4道样例题目JSON数据。

### 附录B：数据库索引建议

```sql
-- 为新增字段添加索引以提升查询性能
CREATE INDEX idx_questions_primary_category_id ON questions(primary_category_id);
CREATE INDEX idx_questions_secondary_category_id ON questions(secondary_category_id);
CREATE INDEX idx_questions_teacher_name ON questions(teacher_name);
CREATE INDEX idx_questions_created_at ON questions(created_at);
CREATE INDEX idx_questions_updated_at ON questions(updated_at);

-- 复合索引（常用组合查询）
CREATE INDEX idx_questions_type_status ON questions(type, status);
CREATE INDEX idx_questions_difficulty_type ON questions(difficulty, type);
```

### 附录C：配置项说明

可在环境变量中配置：

```env
# 题目相关配置
QUESTION_DEFAULT_PAGE_SIZE=20
QUESTION_MAX_PAGE_SIZE=100
QUESTION_TEACHER_NAME_MAX_LENGTH=64
QUESTION_ENABLE_ADVANCED_FILTER=true
```

---

## 七、版本历史

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| 1.0 | 2026-06-17 | AI Assistant | 初始版本，基于方案A设计 |

---

**审核记录：**

- [x] 设计评审通过（2026-06-17）
- [ ] 开发完成
- [ ] 测试通过
- [ ] 上线发布
