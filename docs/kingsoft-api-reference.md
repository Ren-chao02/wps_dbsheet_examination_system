# 金山多维表格 API 参考文档

> 整理自 WPS 开放平台官方文档，用于考试系统的验证引擎对接。
> 数据来源：[WPS开放平台](https://open.wps.cn/documents/app-integration-dev/guide/dbsheet/dbsheet-instro) | [AirScript文档](https://airsheet.wps.cn/docs/)

---

## 目录

1. [开发方式概述](#1-开发方式概述)
2. [服务端 REST API](#2-服务端-rest-api)
3. [AirScript 客户端 API](#3-airscript-客户端-api)
4. [字段类型参考](#4-字段类型参考)
5. [视图类型参考](#5-视图类型参考)
6. [请求示例](#6-请求示例)
7. [考试系统适配指南](#7-考试系统适配指南)

---

## 1. 开发方式概述

WPS 多维表格提供两种开发方式：

| 方式 | 环境 | 适用场景 |
|------|------|----------|
| **服务端 REST API** | 开放平台，WPS-3 签名鉴权 | 后台自动化操作、考试系统验证 |
| **AirScript 脚本** | 在线脚本编辑器，表格内运行 | 表格内自动化、UI 交互 |

**考试系统使用方式**：主要使用 **服务端 REST API** 来读取学生的表格结构、字段、视图、记录等，用于自动判分。AirScript 脚本可用于辅助场景。

---

## 2. 服务端 REST API

### 2.1 基础信息

- **Base URL**: `https://openapi.wps.cn/kopen/office/file/:file_id/core/execute/{action}`
- **请求方法**: 全部为 `POST`
- **鉴权方式**: WPS-3 签名（`Content-Md5` + `Date` + `X-Auth` 头）
- **Content-Type**: `application/json`
- **通用响应**: `{ "result": 0, "detail": {...} }` — `result=0` 表示成功

### 2.2 认证请求头

| Header | 必填 | 说明 |
|--------|------|------|
| `Content-Md5` | 是 | 请求体的 MD5 值（十六进制小写） |
| `Content-Type` | 是 | `application/json` |
| `Date` | 是 | RFC 7231 格式，如 `Wed, 23 Jan 2024 06:43:08 GMT` |
| `X-Auth` | 是 | WPS-3 签名计算结果 |

### 2.3 接口总览

| 分类 | 接口 | 说明 |
|------|------|------|
| **Schema** | `/schema/query` | 查询文件完整 Schema（所有表、字段、视图） |
| **表操作** | `/sheet/create` | 创建工作表 |
| | `/sheet/update` | 更新工作表 |
| | `/sheet/delete` | 删除工作表 |
| **字段操作** | `/fields/create` | 创建字段 |
| | `/fields/update` | 更新字段 |
| | `/fields/delete` | 删除字段 |
| **记录操作** | `/record/create` | 创建记录 |
| | `/record/update` | 更新记录 |
| | `/record/delete` | 删除记录 |
| | `/record/retrieve` | 检索单条记录 |
| | `/record/list` | 分页列举记录 |

### 2.4 Schema 查询 — `/schema/query`

**用途**：这是考试系统**最核心的接口**，用于一次性获取学生表格的完整结构。

```json
// 请求
POST /kopen/office/file/:file_id/core/execute/schema/query

// 响应
{
  "result": 0,
  "detail": {
    "sheets": [
      {
        "id": 6,
        "name": "学生档案",
        "primaryFieldId": "L",
        "fields": [
          {
            "id": "L",
            "name": "姓名",
            "type": "SingleLineText",
            "required": true
          },
          {
            "id": "M",
            "name": "年龄",
            "type": "Number"
          }
        ],
        "views": [
          {
            "id": "F",
            "name": "表格视图",
            "type": "Grid"
          },
          {
            "id": "G",
            "name": "看板视图",
            "type": "Kanban"
          }
        ]
      }
    ]
  }
}
```

**响应字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `sheets[].id` | integer | 数据表 ID |
| `sheets[].name` | string | 数据表名称 |
| `sheets[].primaryFieldId` | string | 主字段 ID（通常是第一列） |
| `sheets[].fields[].id` | string | 字段 ID |
| `sheets[].fields[].name` | string | 字段名称 |
| `sheets[].fields[].type` | string | 字段类型（见[字段类型参考](#4-字段类型参考)） |
| `sheets[].fields[].required` | boolean | 是否必填 |
| `sheets[].views[].id` | string | 视图 ID |
| `sheets[].views[].name` | string | 视图名称 |
| `sheets[].views[].type` | string | 视图类型（见[视图类型参考](#5-视图类型参考)） |

### 2.5 创建表 — `/sheet/create`

```json
// 请求
{
  "param": {
    "name": "学生档案",
    "fields": [
      {
        "name": "姓名",
        "type": "SingleLineText"
      },
      {
        "name": "年龄",
        "type": "Number"
      },
      {
        "name": "性别",
        "type": "SingleSelect",
        "items": [
          { "value": "男" },
          { "value": "女" }
        ]
      }
    ],
    "views": [
      { "name": "表格视图", "type": "Grid" },
      { "name": "看板视图", "type": "Kanban" }
    ]
  }
}
```

### 2.6 创建字段 — `/fields/create`

```json
// 请求
{
  "param": {
    "sheetId": 18,
    "preferId": true,
    "fields": [
      {
        "name": "出生日期",
        "type": "Date"
      }
    ]
  }
}
```

### 2.7 记录操作

**列举记录** — `/record/list`
```json
// 请求
{
  "param": {
    "sheetId": 1,
    "preferId": true,
    "pageSize": 100,
    "showFieldsInfo": true
  }
}

// 响应
{
  "result": 0,
  "detail": {
    "fieldsSchema": [{"id":"L","name":"名称","type":"MultiLineText"}],
    "offset": "o",
    "records": [
      { "id": "g", "fields": {"L": "张三"} }
    ]
  }
}
```

**创建记录** — `/record/create`
```json
{
  "param": {
    "sheetId": 6,
    "preferId": true,
    "fieldsSchema": [
      { "id": "L", "name": "名称", "type": "MultiLineText" }
    ],
    "records": [
      { "fields": { "L": "新记录" } }
    ]
  }
}
```

---

## 3. AirScript 客户端 API

AirScript 是在线脚本环境，运行在多维表格内部。考试系统在 Phase 2+ 可考虑用 AirScript 做辅助操作。

### 3.1 对象层级

```
Application                          // 应用顶级对象
├── Sheets                           // 表集合
│   ├── Add(config)                  // 创建新表
│   └── Item(index) → Sheet          // 获取指定表
│       ├── Id / Name / Index        // 基本属性
│       ├── FieldDescriptors         // 字段定义集合
│       │   ├── Add(fieldConfig)     // 添加字段
│       │   ├── Delete(fieldId)      // 删除字段
│       │   └── Item(index) → FieldDescriptor
│       │       ├── Id / Name / Type // 字段属性
│       │       └── Modify(args)     // 修改字段
│       ├── Views                    // 视图集合
│       │   ├── Add(Type, Name)      // 创建视图
│       │   ├── Delete(viewId)       // 删除视图
│       │   └── Item(index) → View
│       │       ├── Id / Name / Type // 视图属性
│       │       ├── RecordRange      // 视图的记录范围
│       │       ├── Filter / Sort    // 筛选/排序
│       │       └── Modify(args)     // 修改视图
│       └── RecordRange              //（也可从View获取）
│           ├── Add(pos, before, count)  // 添加记录
│           ├── Delete()                 // 删除记录
│           ├── Condition(filters, op)   // 条件筛选
│           ├── Count                    // 记录数
│           └── Value                    // 读/写值
├── ActiveSheet → Sheet              // 当前活动表
└── ActiveView → View                // 当前活动视图
```

### 3.2 Sheets.Add() — 创建表（含字段和视图）

```javascript
// 关键方法：一次性创建表 + 字段 + 视图
Application.Sheets.Add({
    Type: 'xlEtDataBaseSheet',        // 指定为多维表格类型
    Config: {
        name: '数据表',
        fields: [
            {
                fieldType: 'SingleLineText',
                args: { fieldName: '文本', fieldWidth: 15 }
            },
            {
                fieldType: 'SingleSelect',
                args: {
                    fieldName: '单选项',
                    fieldWidth: 15,
                    listItems: [
                        { value: '选项1', color: 4283466178 },
                        { value: '选项2', color: 4281378020 }
                    ]
                }
            },
            {
                fieldType: 'Rating',
                args: { fieldName: '等级', maxRating: 6, fieldWidth: 15 }
            },
            {
                fieldType: 'Date',
                args: { fieldName: '日期', numberFormat: 'yyyy/mm/dd;@', fieldWidth: 15 }
            },
            {
                fieldType: 'Number',
                args: { fieldName: '数字', fieldWidth: 15 }
            }
        ],
        views: [
            { name: '表格视图', type: 'Grid' },
            { name: '表单视图', type: 'Form' }
        ]
    }
})
```

### 3.3 Views.Add() — 创建视图

```javascript
const views = Application.Sheets(1).Views

// 支持 7 种视图类型
views.Add('Grid', '表格视图')      // → GridView
views.Add('Kanban', '看板视图')    // → KanbanView
views.Add('Gallery', '画册视图')   // → GalleryView
views.Add('Form', '表单视图')      // → FormView
views.Add('Calendar', '日历视图')  // → CalendarView
views.Add('Gantt', '甘特视图')     // → GanttView
views.Add('Query', '查询视图')     // → QueryView
```

### 3.4 RecordRange 操作

```javascript
const sheet = Application.Sheets(1)
const view = sheet.Views(1)

// 条件筛选
const criterias = [
    Criteria("@分类", "Equals", ["B"]),
    Criteria("@完成", "Equals", ["1"])
]
const filters = [{ Criterias: criterias, Op: "AND" }]
const range = view.RecordRange.Condition(filters, "AND")

// 读取值
console.log(range.Value) // 二维数组

// 添加记录
const newRange = view.RecordRange.Add(1, undefined, 300) // 在第1行上方添加300条

// 赋值
newRange.Value = [["商品1", 10, "A"], ["商品2", 20, "B"]]

// 删除
range.Delete()

// 监听变化
const ctx = view.RecordRange(1).OnUpdate(data => {
    console.log(data.Id, data.Value)
})
ctx.Destroy() // 取消监听
```

### 3.5 筛选条件 (Criteria)

```javascript
Criteria(fieldName, operator, values)

// 支持的运算符
"Equals"         // 等于
"NotEquals"      // 不等于
"Contains"       // 包含
"NotContains"    // 不包含
"Greater"        // 大于
"GreaterOrEqual" // 大于等于
"Less"           // 小于
"LessOrEqual"    // 小于等于
"IsEmpty"        // 为空
"IsNotEmpty"     // 不为空
```

---

## 4. 字段类型参考

### 4.1 基础字段

| fieldType | 名称 | 值类型 | 可读 | 可写 | 备注 |
|-----------|------|--------|------|------|------|
| `SingleLineText` | 单行文本 | string | ✓ | ✓ | |
| `MultiLineText` | 多行文本 | string | ✓ | ✓ | |
| `Number` | 数字 | number | ✓ | ✓ | |
| `Currency` | 货币 | number | ✓ | ✓ | |
| `Percentage` | 百分比 | number | ✓ | ✓ | |
| `Date` | 日期 | string | ✓ | ✓ | 格式 `yyyy/mm/dd` |
| `Time` | 时间 | string | ✓ | ✓ | 格式 `hh:mm:ss` |
| `Checkbox` | 复选框 | boolean | ✓ | ✓ | |
| `Complete` | 进度条 | number | ✓ | ✓ | 值域 0-100 |
| `Rating` | 等级 | number | ✓ | ✓ | 需设 `max`（1-5） |
| `ID` | 身份证 | string | ✓ | ✓ | |
| `Phone` | 电话 | string | ✓ | ✓ | |
| `Email` | 电子邮箱 | string | ✓ | ✓ | |
| `Url` | 超链接 | object | ✓ | ✗ | {url, displayText} |

### 4.2 选择类字段

| fieldType | 名称 | 值类型 | 创建参数 | 设值格式 |
|-----------|------|--------|----------|----------|
| `SingleSelect` | 单选项 | string | `items: [{value, color}]` | 匹配选项的 value 字符串 |
| `MultipleSelect` | 多选项 | string[] | `items: [{value, color}]` | 匹配选项的 value 字符串数组 |

### 4.3 复杂字段

| fieldType | 名称 | 值类型 | 创建参数 | 可写 |
|-----------|------|--------|----------|------|
| `Attachment` | 附件 | object[] | — | ✗ |
| `Link` | 关联 | string[] | `linkSheet, multipleLinks` | ✗ |
| `Contact` | 联系人 | object[] | — | ✗ |
| `Note` | 富文本 | object | — | ✗ |
| `Address` | 地址 | object | — | ✗ |
| `Cascade` | 级联 | object | — | ✗ |

### 4.4 自动字段 (系统管理，不可写入)

| fieldType | 名称 | 值类型 | 说明 |
|-----------|------|--------|------|
| `AutoNumber` | 自动编号 | number | 自动递增 |
| `CreatedBy` | 创建者 | object | 记录创建人 |
| `CreatedTime` | 创建时间 | string | 记录创建时间 |
| `LastModifiedBy` | 最后修改者 | object | 最后修改人 |
| `LastModifiedTime` | 最后修改时间 | string | 最后修改时间 |

### 4.5 计算字段

| fieldType | 名称 | 值类型 | 说明 |
|-----------|------|--------|------|
| `Formula` | 公式 | 依公式而定 | 计算结果取决于公式表达式 |
| `Lookup` | 引用 | 同被引用字段 | 引用其他表的字段值 |

---

## 5. 视图类型参考

| type 值 | 视图类型 | 说明 |
|---------|----------|------|
| `Grid` | 表格视图 | 类 Excel 网格展示 |
| `Kanban` | 看板视图 | 按字段分组的卡片 |
| `Gallery` | 画册视图 | 图片卡片展示 |
| `Form` | 表单视图 | 逐条记录的表单 |
| `Calendar` | 日历视图 | 按日期展示 |
| `Gantt` | 甘特视图 | 时间线/甘特图 |
| `Query` | 查询视图 | 筛选条件查询 |

---

## 6. 请求示例

### 6.1 完整创建表（含所有字段类型）

```javascript
Application.Sheets.Add({
    Type: 'xlEtDataBaseSheet',
    Config: {
        name: '学生档案',
        fields: [
            { fieldType: 'SingleLineText', args: { fieldName: '姓名', fieldWidth: 15 } },
            { fieldType: 'Number', args: { fieldName: '年龄', fieldWidth: 10 } },
            { fieldType: 'SingleSelect', args: {
                fieldName: '性别', fieldWidth: 10,
                listItems: [{value:'男',color:4283466178},{value:'女',color:4281378020}]
            }},
            { fieldType: 'Date', args: { fieldName: '出生日期', numberFormat: 'yyyy/mm/dd;@', fieldWidth: 15 } },
            { fieldType: 'Email', args: { fieldName: '邮箱', fieldWidth: 20 } },
            { fieldType: 'Phone', args: { fieldName: '电话', fieldWidth: 15 } },
            { fieldType: 'Rating', args: { fieldName: '评级', maxRating: 5, fieldWidth: 10 } },
        ],
        views: [
            { name: '全部学生', type: 'Grid' },
            { name: '报名表单', type: 'Form' },
            { name: '性别看板', type: 'Kanban' }
        ]
    }
})
```

### 6.2 REST API 完整请求示例

```bash
# Schema 查询（最常用于考试验证）
curl -X POST \
  "https://openapi.wps.cn/kopen/office/file/{file_id}/core/execute/schema/query?access_token={token}" \
  -H "Content-Md5: {md5_of_body}" \
  -H "Content-Type: application/json" \
  -H "Date: Wed, 23 Jan 2024 06:43:08 GMT" \
  -H "X-Auth: {wps3_signature}" \
  -d '{}'

# 创建表
curl -X POST \
  "https://openapi.wps.cn/kopen/office/file/{file_id}/core/execute/sheet/create?access_token={token}" \
  -H "Content-Md5: {md5}" \
  -H "Content-Type: application/json" \
  -H "Date: {date}" \
  -H "X-Auth: {signature}" \
  -d '{"param":{"name":"学生表","fields":[{"name":"姓名","type":"SingleLineText"}],"views":[{"name":"表格视图","type":"Grid"}]}}'
```

---

## 7. 考试系统适配指南

### 7.1 核心验证流程

```
学生提交答卷 → 后端获取 file_id 和 access_token
    → 调用 /schema/query 获取完整表结构
    → 规则引擎逐条匹配（表名、字段、视图、筛选条件等）
    → 生成判分报告
```

### 7.2 规则 → API 映射

考试系统中的验证规则对应的 API 操作：

| 验证规则 (action) | API 验证方式 |
|-------------------|-------------|
| `check_table_exists` | `schema/query` → 检查 `sheets[].name` 是否匹配 |
| `check_table_name` | `schema/query` → 模糊匹配 `sheets[].name` |
| `check_table_count` | `schema/query` → `sheets.length` |
| `check_field` | `schema/query` → 匹配 `sheets[].fields[]` 的 `name` + `type` |
| `check_field_count` | `schema/query` → `fields.length` |
| `check_field_required` | `schema/query` → 检查 `field.required` |
| `check_field_formula` | `schema/query` → 检查 `field.type === "Formula"` |
| `check_linked_record` | `schema/query` → 检查 `field.type === "Link"` + `field.linkSheet` |
| `check_view_exists` | `schema/query` → 检查 `views[]` 的 `name` 匹配 |
| `check_view_type` | `schema/query` → 检查 `view.type` |
| `check_view_filter` | 需额外 API（视图详情接口或 AirScript `View.Filter`） |
| `check_view_sort` | 需额外 API（视图详情接口或 AirScript `View.Sort`） |
| `check_view_group` | 看板视图需检查 `view.type === "Kanban"` + 分组字段配置 |
| `check_form_exists` | `schema/query` → 检查 `view.type === "Form"` |
| `check_form_fields` | 需额外 API（表单详情接口） |
| `check_form_settings` | 需额外 API（表单设置接口） |
| `check_record_exists` | `record/list` → 检查记录是否存在 |
| `check_record_value` | `record/list` → 匹配字段值 |
| `check_record_count` | `record/list` → `records.length` |

### 7.3 适配器实现建议

```typescript
// packages/server/src/engine/adapters/kingsoft-adapter.ts

interface KingsoftAdapter {
  // 核心方法：获取完整 Schema
  getSchema(fileId: string, accessToken: string): Promise<SchemaResponse>;

  // 便捷方法（基于 Schema 缓存）
  getTables(fileId: string): Promise<TableInfo[]>;
  getFields(fileId: string, tableId: string): Promise<FieldInfo[]>;
  getViews(fileId: string, tableId: string): Promise<ViewInfo[]>;
  getRecords(fileId: string, tableId: string, options?: RecordOptions): Promise<Record[]>;
}

// API 错误处理
// - 401: access_token 过期 → 刷新或提示学生重新授权
// - 404: file_id 无效 → 提示检查表格链接
// - 429: 频率限制 → 指数退避重试
```

### 7.4 鉴权流程

```
1. 学生在考试系统中点击"开始考试"
2. 系统引导学生在 WPS 中打开考试表格
3. 学生授权考试应用访问其表格
4. 系统获取 access_token 和 file_id
5. 存储到 student_submissions.table_space_id
6. 判分时使用 token 调用 API
```

---

## 附录：快速参考卡片

### 字段类型速查
```
文本类: SingleLineText, MultiLineText, Note
数字类: Number, Currency, Percentage, Rating, Complete
日期类: Date, Time
选择类: SingleSelect, MultipleSelect, Checkbox
关联类: Link, Lookup, Cascade
联系类: Email, Phone, Url, Contact, Address, ID
文件类: Attachment
自动类: AutoNumber, CreatedBy, CreatedTime, LastModifiedBy, LastModifiedTime
计算类: Formula
```

### 视图类型速查
```
Grid → 表格    Kanban → 看板    Gallery → 画册
Form → 表单    Calendar → 日历  Gantt → 甘特
Query → 查询
```

### 筛选运算符
```
Equals, NotEquals, Contains, NotContains,
Greater, GreaterOrEqual, Less, LessOrEqual,
IsEmpty, IsNotEmpty
```
