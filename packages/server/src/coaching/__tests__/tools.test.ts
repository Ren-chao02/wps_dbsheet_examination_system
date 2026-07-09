/**
 * coaching/tools 测试 — Phase 2 §4.3
 *
 * 3 个 tool 定义 + handler：
 *   - get_capability_detail  （始终可用，查能力图谱）
 *   - get_standard_answer_schema （需 adapter，返回 Schema 摘要）
 *   - get_records            （需 adapter，返回记录，截断保护）
 *
 * 不变量：accessToken 永不进 LLM。
 *   handler 只接收 LLM 的 args + 服务端 ctx（ctx.adapter 封装凭据）。
 */
import { describe, it, expect } from 'vitest';
import {
  COACHING_TOOLS,
  executeTool,
  MAX_RECORDS,
  MAX_RECORDS_BYTES,
  MAX_FIELDS_PER_SHEET,
  type ToolContext,
} from '../tools';
import { findCapability } from '../../data/capability-graph';
import type { SchemaResponse } from '../../engine/adapters/kingsoft-adapter';

// ============================================================
// Fake adapter（注入，不用 vi.mock）
// ============================================================

interface FakeAdapterOpts {
  schema?: SchemaResponse;
  records?: Record<string, { id: string; fields: Record<string, any> }[]>;
  schemaError?: Error;
  recordsError?: Error;
}

function makeFakeAdapter(opts: FakeAdapterOpts): any {
  return {
    async getSchema() {
      if (opts.schemaError) throw opts.schemaError;
      return opts.schema!;
    },
    async getRecordsByTableName(tableName: string) {
      if (opts.recordsError) throw opts.recordsError;
      // 忠实复刻真实 KingsoftAdapter：表不存在则抛错
      const sheetNames = opts.schema?.detail.sheets.map(s => s.name) ?? [];
      if (!sheetNames.includes(tableName)) {
        throw new Error(`表 "${tableName}" 不存在`);
      }
      const records = opts.records?.[tableName] ?? [];
      return { records, fieldsSchema: [] };
    },
  };
}

function makeSchema(sheets: any[]): SchemaResponse {
  return { result: 0, detail: { sheets } };
}

/** 构造 1 张表、3 个字段、2 个视图的 Schema */
function makeSimpleSchema(): SchemaResponse {
  return makeSchema([
    {
      id: 1,
      name: '员工表',
      primaryFieldId: 'f1',
      fields: [
        { id: 'f1', name: '姓名', type: 'SingleLineText' },
        { id: 'f2', name: '年龄', type: 'Number', numberFormat: '0' },
        {
          id: 'f3',
          name: '状态',
          type: 'SingleSelect',
          items: [{ value: '在职' }, { value: '离职' }],
        },
      ],
      views: [
        { id: 'v1', name: '表格视图', type: 'Grid' },
        { id: 'v2', name: '入职表单', type: 'Form' },
      ],
    },
  ]);
}

// ============================================================
// 测试
// ============================================================

describe('coaching/tools', () => {
  // ============================================================
  // Tool 定义
  // ============================================================
  describe('COACHING_TOOLS 定义', () => {
    it('恰好注册 3 个 tool：get_capability_detail / get_standard_answer_schema / get_records', () => {
      expect(COACHING_TOOLS).toHaveLength(3);
      const names = COACHING_TOOLS.map(t => t.function.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'get_capability_detail',
          'get_standard_answer_schema',
          'get_records',
        ]),
      );
    });

    it('tool 参数中不含 fileId/accessToken（accessToken 永不进 LLM）', () => {
      for (const tool of COACHING_TOOLS) {
        const props = (tool.function.parameters as any).properties || {};
        expect(props).not.toHaveProperty('fileId');
        expect(props).not.toHaveProperty('accessToken');
      }
    });
  });

  // ============================================================
  // get_capability_detail
  // ============================================================
  describe('get_capability_detail', () => {
    it('合法 id 返回完整能力（含 examPatterns / ruleActions / prerequisites）', async () => {
      const res = await executeTool(
        'get_capability_detail',
        { capabilityId: 'field.single_select' },
        {},
      );
      expect('result' in res).toBe(true);
      if (!('result' in res)) return;
      const cap = res.result;
      // 含 examPatterns / ruleActions / prerequisites
      expect(cap.id).toBe('field.single_select');
      expect(Array.isArray(cap.ruleActions)).toBe(true);
      expect(cap.ruleActions.length).toBeGreaterThan(0);
      expect(Array.isArray(cap.examPatterns)).toBe(true);
    });

    it('与 findCapability 返回一致（含 promptHints）', async () => {
      const res = await executeTool(
        'get_capability_detail',
        { capabilityId: 'table.create' },
        {},
      );
      if (!('result' in res)) throw new Error('expected result');
      const expected = findCapability('table.create');
      expect(res.result.id).toBe(expected!.id);
      expect(res.result.name).toBe(expected!.name);
      expect(res.result.promptHints).toBe(expected!.promptHints);
    });

    it('不存在 id 返回 found:false（让 LLM 自我纠正，而非 error）', async () => {
      const res = await executeTool(
        'get_capability_detail',
        { capabilityId: 'fake.capability' },
        {},
      );
      expect(res).toEqual({ result: { found: false, capabilityId: 'fake.capability' } });
    });

    it('缺 capabilityId 参数返回 error', async () => {
      const res = await executeTool('get_capability_detail', {}, {});
      expect('error' in res).toBe(true);
    });
  });

  // ============================================================
  // get_standard_answer_schema
  // ============================================================
  describe('get_standard_answer_schema', () => {
    it('无 adapter（未导入标准答案）返回 available:false', async () => {
      const res = await executeTool('get_standard_answer_schema', {}, {});
      expect(res).toEqual({
        result: { available: false, reason: '未导入标准答案' },
      });
    });

    it('有 adapter 返回 Schema 摘要（表/字段/视图）', async () => {
      const ctx: ToolContext = { adapter: makeFakeAdapter({ schema: makeSimpleSchema() }) as any };
      const res = await executeTool('get_standard_answer_schema', {}, ctx);
      if (!('result' in res)) throw new Error('expected result');
      expect(res.result.available).toBe(true);
      expect(res.result.sheets).toHaveLength(1);
      const sheet = res.result.sheets[0];
      expect(sheet.name).toBe('员工表');
      expect(sheet.fields).toHaveLength(3);
      expect(sheet.fields[0]).toEqual({ id: 'f1', name: '姓名', type: 'SingleLineText' });
      expect(sheet.views).toHaveLength(2);
      expect(sheet.views[0]).toEqual({ id: 'v1', name: '表格视图', type: 'Grid' });
    });

    it('字段数超 200 截断并附 note', async () => {
      const manyFields = Array.from({ length: 250 }, (_, i) => ({
        id: `f${i}`,
        name: `字段${i}`,
        type: 'SingleLineText',
      }));
      const schema = makeSchema([
        { id: 1, name: '大表', primaryFieldId: 'f0', fields: manyFields, views: [] },
      ]);
      const ctx: ToolContext = { adapter: makeFakeAdapter({ schema }) as any };
      const res = await executeTool('get_standard_answer_schema', {}, ctx);
      if (!('result' in res)) throw new Error('expected result');
      expect(res.result.sheets[0].fields).toHaveLength(MAX_FIELDS_PER_SHEET);
      expect(res.result.notes.some((n: string) => n.includes('大表'))).toBe(true);
      expect(res.result.notes.some((n: string) => n.includes('截断'))).toBe(true);
    });

    it('adapter 抛 401 → 返回 error（透传，不吞错）', async () => {
      const err = Object.assign(new Error('Unauthorized'), { status: 401 });
      const ctx: ToolContext = {
        adapter: makeFakeAdapter({ schemaError: err }) as any,
      };
      const res = await executeTool('get_standard_answer_schema', {}, ctx);
      expect('error' in res).toBe(true);
      if (!('error' in res)) return;
      expect(res.error).toContain('Unauthorized');
    });
  });

  // ============================================================
  // get_records
  // ============================================================
  describe('get_records', () => {
    it('无 adapter 返回 available:false', async () => {
      const res = await executeTool('get_records', { tableName: '员工表' }, {});
      expect(res).toEqual({
        result: { available: false, reason: '未导入标准答案' },
      });
    });

    it('有 adapter 返回指定表记录', async () => {
      const records = [
        { id: 'r1', fields: { 姓名: '张三', 年龄: 30 } },
        { id: 'r2', fields: { 姓名: '李四', 年龄: 25 } },
      ];
      const ctx: ToolContext = {
        adapter: makeFakeAdapter({
          schema: makeSimpleSchema(),
          records: { 员工表: records },
        }) as any,
      };
      const res = await executeTool('get_records', { tableName: '员工表' }, ctx);
      if (!('result' in res)) throw new Error('expected result');
      expect(res.result.available).toBe(true);
      expect(res.result.tableName).toBe('员工表');
      expect(res.result.records).toHaveLength(2);
      expect(res.result.records[0].fields.姓名).toBe('张三');
      expect(res.result.truncated).toBe(false);
    });

    it('超过 50 条按数量截断 + truncated=true + note', async () => {
      const records = Array.from({ length: 60 }, (_, i) => ({
        id: `r${i}`,
        fields: { 姓名: `员工${i}` },
      }));
      const ctx: ToolContext = {
        adapter: makeFakeAdapter({
          schema: makeSimpleSchema(),
          records: { 员工表: records },
        }) as any,
      };
      const res = await executeTool('get_records', { tableName: '员工表' }, ctx);
      if (!('result' in res)) throw new Error('expected result');
      expect(res.result.records).toHaveLength(MAX_RECORDS);
      expect(res.result.truncated).toBe(true);
      expect(res.result.note).toContain('50');
    });

    it('单条过大按字节截断至 8KB 内 + truncated=true', async () => {
      // 5 条记录，每条 ~2KB → 总 ~10KB，应截到 8KB 内
      const big = 'x'.repeat(2000);
      const records = Array.from({ length: 5 }, (_, i) => ({
        id: `r${i}`,
        fields: { 备注: big },
      }));
      const ctx: ToolContext = {
        adapter: makeFakeAdapter({
          schema: makeSimpleSchema(),
          records: { 员工表: records },
        }) as any,
      };
      const res = await executeTool('get_records', { tableName: '员工表' }, ctx);
      if (!('result' in res)) throw new Error('expected result');
      const size = Buffer.byteLength(JSON.stringify(res.result.records), 'utf-8');
      expect(size).toBeLessThanOrEqual(MAX_RECORDS_BYTES);
      expect(res.result.truncated).toBe(true);
      expect(res.result.records.length).toBeLessThan(5);
    });

    it('表不存在 → 返回 error', async () => {
      const ctx: ToolContext = {
        adapter: makeFakeAdapter({
          schema: makeSimpleSchema(),
          records: {},
        }) as any,
      };
      const res = await executeTool('get_records', { tableName: '不存在的表' }, ctx);
      expect('error' in res).toBe(true);
      if (!('error' in res)) return;
      expect(res.error).toContain('不存在');
    });

    it('缺 tableName 参数返回 error', async () => {
      const ctx: ToolContext = {
        adapter: makeFakeAdapter({ schema: makeSimpleSchema() }) as any,
      };
      const res = await executeTool('get_records', {}, ctx);
      expect('error' in res).toBe(true);
    });
  });

  // ============================================================
  // executeTool 未知工具
  // ============================================================
  describe('executeTool 未知工具', () => {
    it('未知 tool 名返回 error', async () => {
      const res = await executeTool('fake_tool', {}, {});
      expect('error' in res).toBe(true);
      if (!('error' in res)) return;
      expect(res.error).toContain('fake_tool');
    });
  });
});
