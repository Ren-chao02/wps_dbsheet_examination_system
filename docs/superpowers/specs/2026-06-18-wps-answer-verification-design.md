# WPS多维表格答题验证方案 — 生产落地设计

## 1. 问题陈述

当前系统已有 rule-engine 和 KingsoftAdapter，但存在以下问题：
- 题库 JSON 中的 `answerRules.action`（如 `verify_table_exists`）与 rule-engine handler（如 `check_table_exists`）不匹配
- 部分验证规则标记为 `needsReview=true` 但实际上可通过 WPS API 获取详情
- 记录级验证已实现但未充分利用
- 缺少字段属性细节验证（数字格式、日期格式、选项值、唯一约束等）

## 2. 验证维度架构

### 2.1 五层验证模型

| 层级 | 验证对象 | WPS API 端点 | 可自动化程度 |
|------|---------|-------------|-------------|
| L1 | 表结构 | `GET /{file_id}/schema` | 100% |
| L2 | 字段属性 | `GET /{file_id}/schema` | 90%（公式表达式需人工） |
| L3 | 视图配置 | `GET /{file_id}/schema`（仅基础信息） | 30%（filter/sort/group需人工） |
| L4 | 记录数据 | `POST /{file_id}/sheets/{sheet_id}/records` | 100% |
| L5 | 公式/计算 | 需执行验证或人工 | 30% |

### 2.2 WPS API 能力矩阵（基于真实API测试 2026-06-18）

| 能力 | API 端点 | 方法 | 测试状态 | 返回数据 |
|------|---------|------|---------|---------|
| 获取表结构 | `GET /v7/coop/dbsheet/{file_id}/schema` | GET | ✅ 已测试 | 完整sheets/fields/views基础信息 |
| 获取记录列表 | `POST /v7/coop/dbsheet/{file_id}/sheets/{sheet_id}/records` | POST | ✅ 已测试 | records[].fields为JSON字符串 |
| 检索单条记录 | `GET /v7/coop/dbsheet/{file_id}/sheets/{sheet_id}/records/{record_id}` | GET | ✅ 已测试 | 单条记录，fields为JSON字符串 |
| 列出视图 | `GET /v7/dbsheet/{file_id}/sheets/{sheet_id}/views` | GET | ✅ 已测试 | `{views: [{id, name, type}]}` |
| 获取视图详情 | `GET /v7/dbsheet/{file_id}/sheets/{sheet_id}/views/{view_id}` | GET | ✅ 已测试 | `{view: {id, name, type}}`，**不含filter/sort/group** |
| 获取表单字段 | `GET /v7/dbsheet/{file_id}/sheets/{sheet_id}/forms/{view_id}/fields` | GET | ✅ 已测试 | `{form_fields: [{field_id, title, description, required}]}` |

### 2.3 真实API数据结构关键发现

1. **records[].fields 是 JSON 字符串**，需要 `JSON.parse()` 解析后才能读取字段值
   ```json
   {"records": [{"id": "B", "fields": "{\"单选项\":\"选项1\",\"数字\":123456789}"}]}
   ```

2. **link_sheet 是数字ID**（如 `4`），不是表名，需要通过 sheet ID 映射到表名
   ```json
   {"type": "Link", "data": {"link_sheet": 4, "link_field": "P"}}
   ```

3. **视图对象不包含 filter/sort/group**，只有 `{id, name, type, records_count}`
   - 获取视图详情API也只返回 `{view: {id, name, type}}`
   - **结论**：视图filter/sort/group验证必须标记为 needsReview

4. **字段属性嵌套在 data 对象中**
   ```json
   {"name": "单选项", "type": "SingleSelect", "data": {"items": [...], "allow_add_item_while_inputting": true}}
   {"name": "数字", "type": "Number", "data": {"number_format": "0.00_ "}}
   {"name": "联系方式", "type": "Phone", "data": {"unique_value": true}}
   ```

5. **表单字段API可用**，返回字段配置信息
   ```json
   {"form_fields": [{"field_id": "U", "title": "货币", "description": "", "required": false}]}
   ```

6. **records_count 在 sheet 和 view 层级都有**，可直接用于记录数量验证，无需拉取记录

## 3. 规则引擎扩展清单

### 3.1 现有规则（已实现，保留）

| Action | 说明 | 层级 |
|--------|------|------|
| `check_table_exists` | 验证表是否存在 | L1 |
| `check_table_name` | 验证表名称（模糊匹配） | L1 |
| `check_table_count` | 验证表数量 | L1 |
| `check_field` | 验证字段存在+类型 | L2 |
| `check_field_count` | 验证字段数量 | L2 |
| `check_field_required` | 验证字段必填 | L2 |
| `check_view_exists` | 验证视图存在 | L3 |
| `check_view_type` | 验证视图类型 | L3 |
| `check_form_exists` | 验证表单视图存在 | L3 |
| `check_linked_record` | 验证关联字段 | L2 |
| `check_record_exists` | 验证记录存在 | L4 |
| `check_record_value` | 验证记录值匹配 | L4 |
| `check_record_count` | 验证记录数量 | L4 |

### 3.2 新增规则（需实现）

| Action | 说明 | 层级 | params |
|--------|------|------|--------|
| `check_field_options` | 验证选择字段的选项值 | L2 | `{tableName, fieldName, options[], matchMode}` |
| `check_field_format` | 验证字段格式（数字/日期/时间） | L2 | `{tableName, fieldName, format}` |
| `check_field_unique` | 验证字段唯一约束 | L2 | `{tableName, fieldName}` |
| `check_field_default_value` | 验证字段默认值 | L2 | `{tableName, fieldName, defaultValue}` |
| `check_field_formula` | 验证公式字段（改进版） | L2 | `{tableName, fieldName, formulaPattern}` |
| `check_field_link_target` | 验证关联目标表 | L2 | `{tableName, fieldName, targetTable}` |
| `check_view_filter` | 验证视图筛选条件（改进版） | L3 | `{tableName, viewName, filters}` |
| `check_view_sort` | 验证视图排序（改进版） | L3 | `{tableName, viewName, sortFields}` |
| `check_view_group` | 验证视图分组（改进版） | L3 | `{tableName, viewName, groupFields}` |
| `check_form_fields` | 验证表单字段配置（改进版） | L3 | `{tableName, formName, fields[]}` |
| `check_record_value_exact` | 验证记录值精确匹配 | L4 | `{tableName, fieldName, value}` |
| `check_record_field_count` | 验证记录字段数量 | L4 | `{tableName, fieldName, count}` |
| `check_table_fields` | 验证表包含所有指定字段 | L2 | `{tableName, fields[]}` |

### 3.3 规则命名统一

将题库 JSON 中的 action 统一为 `check_*` 前缀，与 rule-engine handler 一致：

| 旧命名（题库JSON） | 新命名（统一） |
|-------------------|---------------|
| `verify_table_exists` | `check_table_exists` |
| `verify_table_name` | `check_table_name` |
| `verify_field_exists` | `check_field` |
| `verify_field_type` | `check_field`（带 type 参数） |
| `verify_single_select_options` | `check_field_options` |
| `verify_multi_select_options` | `check_field_options` |
| `verify_date_format` | `check_field_format` |
| `verify_default_value` | `check_field_default_value` |
| `verify_unique_constraint` | `check_field_unique` |
| `verify_relation_field` | `check_field_link_target` |
| `verify_view_exists` | `check_view_exists` |
| `verify_record_exists` | `check_record_exists` |
| `verify_record_value` | `check_record_value` |

## 4. 数据流设计

```
学生提交答卷
    ↓
grading-service.gradeSubmission()
    ↓
┌─ 解析 tableSpaceId → KingsoftAdapter
│
├─ adapter.getSchema() → SchemaResponse
│   └─ GET /{file_id}/schema
│
├─ 预扫描规则 → 识别需要记录数据的规则
│   └─ adapter.getRecordsByTableName() → RecordData
│       └─ POST /{file_id}/sheets/{sheet_id}/records
│
├─ evaluateRules(schema, rules, recordData)
│   └─ 逐条匹配 ruleHandlers[action](schema, params, records)
│
├─ 写入 verification_results 表
│
└─ 汇总得分 → 更新 student_submissions
```

## 5. 实现计划

### Phase 1: 规则引擎扩展
1. 统一 action 命名（rule-engine.ts）
2. 新增 L2 字段属性验证规则（check_field_options, check_field_format, check_field_unique, check_field_link_target）
3. 新增 L3 表单字段验证规则（check_form_fields, check_form_field_required）- 使用表单字段API
4. 新增 L4 记录验证规则（check_record_value_exact）
5. 视图filter/sort/group和公式验证标记为needsReview（API不支持）

### Phase 2: KingsoftAdapter 增强
1. 添加表单字段API调用方法 `getFormFields(sheetId, viewId)`
2. 优化记录数据获取（批量获取多表记录，JSON.parse fields）
3. 添加 sheet ID 到表名的映射（用于link字段验证）
4. 添加错误重试和超时处理

### Phase 3: 题库数据迁移
1. 将 question_bank_wps_multidimensional_table.json 中的 action 统一为新命名
2. 补充缺失的验证规则参数
3. 验证迁移后数据格式与 rule-engine 兼容

### Phase 4: 集成测试
1. 使用真实 WPS API 测试各验证规则
2. 验证 needsReview 标记准确性
3. 性能测试（多学生并发判分）

## 6. 错误处理与降级

| 场景 | 处理方式 |
|------|---------|
| WPS API 不可用 | 标记所有规则为 needsReview，通知教师 |
| Token 过期 | 自动刷新或提示管理员更新 |
| Schema 解析失败 | 记录错误日志，降级为人工复核 |
| 记录数据获取超时 | 跳过记录级规则，标记 needsReview |
| 公式验证 | 始终标记 needsReview（WPS API 不返回公式详情） |

## 7. 性能考虑

- Schema 获取：每次判分获取一次，缓存到内存（5分钟过期）
- 记录数据：仅预获取规则中引用的表，避免全量拉取
- 并发判分：通过 BullMQ 队列串行化，避免 API 限流
- 批量判分：逐份处理，失败不阻塞后续
