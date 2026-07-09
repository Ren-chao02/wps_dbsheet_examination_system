import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SchemaResponse } from '../rule-engine';

/**
 * 标准答案反向器测试
 *
 * 通过 vi.mock 替换 KingsoftAdapter，注入 mock Schema，
 * 验证 6 个 Matcher 的扫描逻辑与 applyTemplate 填充。
 *
 * @see docs/superpowers/specs/2026-07-07-exam-authoring-assist.md §5.3
 */

// ------------------------------------------------------------
// Mock KingsoftAdapter
// ------------------------------------------------------------

/** mock Schema（由各测试用例覆盖） */
let mockSchema: SchemaResponse;
/** mock getSchema 是否抛错（模拟 401） */
let mockGetSchemaError: Error | null = null;

vi.mock('../adapters/kingsoft-adapter', () => ({
  KingsoftAdapter: class MockKingsoftAdapter {
    constructor(
      _fileId: string,
      _accessToken: string,
      _apiSecret?: string,
    ) {}
    async getSchema(): Promise<SchemaResponse> {
      if (mockGetSchemaError) throw mockGetSchemaError;
      return mockSchema;
    }
  },
}));

// 反向器在 mock 之后导入，确保 mock 生效
import { AnswerReverser } from '../answer-reverser';

// ------------------------------------------------------------
// 测试 fixture：构造 SchemaResponse
// ------------------------------------------------------------

function makeSchema(sheets: any[]): SchemaResponse {
  return { result: 0, detail: { sheets } };
}

/** 构造一个含单选字段+选项的表 */
function makeSchemaWithSingleSelect(): SchemaResponse {
  return makeSchema([
    {
      id: 1,
      name: '考勤表',
      primaryFieldId: 'f1',
      fields: [
        { id: 'f1', name: '姓名', type: 'SingleLineText' },
        {
          id: 'f2',
          name: '考勤状态',
          type: 'SingleSelect',
          items: [
            { value: '出勤', color: 1 },
            { value: '请假', color: 2 },
            { value: '缺勤', color: 3 },
          ],
        },
        { id: 'f3', name: '年龄', type: 'Number', numberFormat: '0' },
      ],
      views: [
        { id: 'v1', name: '表格视图1', type: 'Grid' },
        { id: 'v2', name: '考勤表单', type: 'Form' },
      ],
    },
    {
      id: 2,
      name: '部门表',
      primaryFieldId: 'f4',
      fields: [
        { id: 'f4', name: '部门名称', type: 'SingleLineText' },
        { id: 'f5', name: '关联员工', type: 'Link', linkSheet: 1 },
      ],
      views: [{ id: 'v3', name: '表格视图2', type: 'Grid' }],
    },
  ]);
}

// ------------------------------------------------------------
// 测试
// ------------------------------------------------------------

describe('AnswerReverser', () => {
  const reverser = new AnswerReverser();

  beforeEach(() => {
    mockSchema = makeSchemaWithSingleSelect();
    mockGetSchemaError = null;
  });

  // ============================================================
  // §5.3 反向生成单选字段规则（含 options）
  // ============================================================
  describe('单选字段规则反向生成', () => {
    it('为 SingleSelect 字段生成 check_field + check_field_options 规则', async () => {
      const output = await reverser.reverse({
        capabilities: ['field.single_select'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      // 1 个 SingleSelect 字段 × 2 个模板 = 2 条建议
      expect(output.suggestions).toHaveLength(2);

      const actions = output.suggestions.map(s => s.rule.action);
      expect(actions).toContain('check_field');
      expect(actions).toContain('check_field_options');
    });

    it('check_field 规则参数 100% 来自真实 Schema', async () => {
      const output = await reverser.reverse({
        capabilities: ['field.single_select'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      const checkFieldRule = output.suggestions.find(
        s => s.rule.action === 'check_field',
      )!;
      expect(checkFieldRule.rule.params.tableName).toBe('考勤表');
      expect(checkFieldRule.rule.params.fieldName).toBe('考勤状态');
      expect(checkFieldRule.rule.params.type).toBe('single_select');
    });

    it('check_field_options 规则含真实选项值（item.value）', async () => {
      const output = await reverser.reverse({
        capabilities: ['field.single_select'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      const optionsRule = output.suggestions.find(
        s => s.rule.action === 'check_field_options',
      )!;
      expect(optionsRule.rule.params.options).toEqual(['出勤', '请假', '缺勤']);
      expect(optionsRule.rule.params.matchMode).toBe('exact');
    });

    it('完全填充的规则 selected=true 且 editable=false', async () => {
      const output = await reverser.reverse({
        capabilities: ['field.single_select'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      for (const s of output.suggestions) {
        expect(s.selected).toBe(true);
        expect(s.editable).toBe(false);
        expect(s.missingParams).toEqual([]);
      }
    });

    it('source 含 sheetName 和 fieldName', async () => {
      const output = await reverser.reverse({
        capabilities: ['field.single_select'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      for (const s of output.suggestions) {
        expect(s.source.sheetName).toBe('考勤表');
        expect(s.source.fieldName).toBe('考勤状态');
        expect(s.source.capabilityId).toBe('field.single_select');
      }
    });
  });

  // ============================================================
  // §5.3 标准答案无匹配能力返回空建议
  // ============================================================
  describe('无匹配能力', () => {
    it('Schema 中无 Kanban 视图时返回空建议 + note', async () => {
      const output = await reverser.reverse({
        capabilities: ['view.kanban'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      expect(output.suggestions).toEqual([]);
      expect(output.notes.some(n => n.includes('未找到匹配项'))).toBe(true);
    });

    it('未知能力 id 记入 notes 且不影响其他能力', async () => {
      const output = await reverser.reverse({
        capabilities: ['field.single_select', 'fake.capability'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      expect(output.suggestions.length).toBeGreaterThan(0);
      expect(output.notes.some(n => n.includes('fake.capability'))).toBe(true);
    });
  });

  // ============================================================
  // §5.3 accessToken 过期透传 401
  // ============================================================
  describe('accessToken 过期', () => {
    it('getSchema 抛 401 错误时透传', async () => {
      mockGetSchemaError = Object.assign(new Error('Unauthorized'), {
        status: 401,
        response: { status: 401 },
      });

      await expect(
        reverser.reverse({
          capabilities: ['field.single_select'],
          fileId: 'file-1',
          accessToken: 'expired-token',
        }),
      ).rejects.toThrow('Unauthorized');
    });
  });

  // ============================================================
  // 多域能力
  // ============================================================
  describe('多域能力', () => {
    it('同时反向生成表+字段+视图规则', async () => {
      const output = await reverser.reverse({
        capabilities: ['table.create', 'field.text', 'view.grid'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      const actions = output.suggestions.map(s => s.rule.action);
      // table.create → check_table_exists（2 张表 = 2 条）
      expect(actions.filter(a => a === 'check_table_exists').length).toBe(2);
      // field.text → check_field（2 个 SingleLineText 字段）
      expect(actions.filter(a => a === 'check_field').length).toBe(2);
      // view.grid → check_view_type（2 个 Grid 视图）
      expect(actions.filter(a => a === 'check_view_type').length).toBe(2);
    });

    it('关联字段反向生成 link_target 规则', async () => {
      const output = await reverser.reverse({
        capabilities: ['field.link'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      // 1 个 Link 字段，2 个模板（check_field + check_field_link_target）
      expect(output.suggestions).toHaveLength(2);

      const linkRule = output.suggestions.find(
        s => s.rule.action === 'check_field_link_target',
      )!;
      expect(linkRule.rule.params.tableName).toBe('部门表');
      expect(linkRule.rule.params.fieldName).toBe('关联员工');
      expect(linkRule.rule.params.targetTable).toBe('考勤表');
    });
  });

  // ============================================================
  // 缺参数的规则（editable）
  // ============================================================
  describe('缺参数规则', () => {
    it('record.update 缺 recordValue → editable=true, selected=false', async () => {
      const output = await reverser.reverse({
        capabilities: ['record.update'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      // 每张表 × 每个字段 = (3 + 2) = 5 条
      const editable = output.suggestions.filter(s => s.editable);
      expect(editable.length).toBeGreaterThan(0);
      for (const s of editable) {
        expect(s.selected).toBe(false);
        expect(s.missingParams).toContain('value');
      }
    });

    it('form.fields 缺 formFieldNames → editable=true', async () => {
      const output = await reverser.reverse({
        capabilities: ['form.fields'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      // 1 个 Form 视图
      expect(output.suggestions).toHaveLength(1);
      expect(output.suggestions[0].editable).toBe(true);
      expect(output.suggestions[0].missingParams).toContain('fields');
    });
  });

  // ============================================================
  // schemaSummary
  // ============================================================
  describe('schemaSummary', () => {
    it('返回正确的表/视图/表单摘要', async () => {
      const output = await reverser.reverse({
        capabilities: ['table.create'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      expect(output.schemaSummary.sheets).toHaveLength(2);
      expect(output.schemaSummary.sheets[0]).toEqual({
        name: '考勤表',
        fieldCount: 3,
        viewCount: 2,
      });
      expect(output.schemaSummary.sheets[1]).toEqual({
        name: '部门表',
        fieldCount: 2,
        viewCount: 1,
      });
      // 1 个 Form 视图
      expect(output.schemaSummary.forms).toHaveLength(1);
      expect(output.schemaSummary.forms[0].name).toBe('考勤表单');
    });
  });

  // ============================================================
  // 字段属性 Matcher
  // ============================================================
  describe('字段属性反向生成', () => {
    it('field_prop.options 为选择字段生成选项校验规则', async () => {
      const output = await reverser.reverse({
        capabilities: ['field_prop.options'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      expect(output.suggestions).toHaveLength(1);
      expect(output.suggestions[0].rule.params.options).toEqual([
        '出勤', '请假', '缺勤',
      ]);
    });

    it('field_prop.format 为带 numberFormat 的字段生成格式规则', async () => {
      const output = await reverser.reverse({
        capabilities: ['field_prop.format'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      // 只有"年龄"字段有 numberFormat
      expect(output.suggestions).toHaveLength(1);
      expect(output.suggestions[0].rule.params.fieldName).toBe('年龄');
      expect(output.suggestions[0].rule.params.format).toBe('0');
    });

    it('field_prop.required 只匹配 required=true 的字段', async () => {
      // fixture 中无 required 字段
      const output = await reverser.reverse({
        capabilities: ['field_prop.required'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      expect(output.suggestions).toEqual([]);
      expect(output.notes.some(n => n.includes('未找到匹配项'))).toBe(true);
    });
  });

  // ============================================================
  // table.multi 特殊处理（sheetCount 注入）
  // ============================================================
  describe('table.multi sheetCount 注入', () => {
    it('check_table_count 规则含真实表数量', async () => {
      const output = await reverser.reverse({
        capabilities: ['table.multi'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      expect(output.suggestions).toHaveLength(1);
      expect(output.suggestions[0].rule.action).toBe('check_table_count');
      expect(output.suggestions[0].rule.params.count).toBe(2); // 2 张表
      expect(output.suggestions[0].selected).toBe(true);
    });
  });

  // ============================================================
  // needsReview 能力（无 template）
  // ============================================================
  describe('needsReview 能力', () => {
    it('view.filter 有 Match 但无 template → 0 条建议', async () => {
      const output = await reverser.reverse({
        capabilities: ['view.filter'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      // view.filter 的 ruleTemplate 为 null，不会生成建议
      expect(output.suggestions).toEqual([]);
      // 但有匹配项（3 个视图），故无"未找到匹配项"note
      expect(output.notes.some(n => n.includes('未找到匹配项'))).toBe(false);
    });

    it('view.hide_fields manual 能力 → 0 条建议', async () => {
      const output = await reverser.reverse({
        capabilities: ['view.hide_fields'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });

      expect(output.suggestions).toEqual([]);
    });
  });
});
