import { describe, it, expect } from 'vitest';
import {
  CAPABILITY_GRAPH,
  ALL_DOMAINS,
  DOMAIN_LABELS,
  VALID_RULE_ACTIONS,
  findCapability,
  capabilitiesByDomain,
} from '../capability-graph';

/**
 * 能力图谱数据完整性测试
 *
 * 守护 6 域 66 项能力图谱的结构正确性，防止后续编辑引入：
 * - 总数/域分布漂移
 * - id 重复
 * - ruleActions 引用了 rule-engine 不支持的 action
 * - prerequisites 指向不存在的能力
 * - scorable=auto 但无任何可执行 ruleTemplate（出题人会勾选却生成不出规则）
 *
 * @see docs/superpowers/specs/2026-07-07-exam-authoring-assist.md §5.1
 */
describe('能力图谱数据完整性', () => {
  // ============================================================
  // 总数与域分布
  // ============================================================
  describe('总数与域分布', () => {
    it('总能力项数为 66（6 域聚合）', () => {
      expect(CAPABILITY_GRAPH).toHaveLength(66);
    });

    it('6 个域全部存在且 DOMAIN_LABELS 覆盖', () => {
      expect(ALL_DOMAINS).toHaveLength(6);
      for (const domain of ALL_DOMAINS) {
        expect(DOMAIN_LABELS[domain]).toBeTruthy();
      }
    });

    it('域分布：tables=6 / fields=29 / field_props=6 / views=12 / forms=5 / records=8', () => {
      expect(capabilitiesByDomain('tables')).toHaveLength(6);
      expect(capabilitiesByDomain('fields')).toHaveLength(29);
      expect(capabilitiesByDomain('field_props')).toHaveLength(6);
      expect(capabilitiesByDomain('views')).toHaveLength(12);
      expect(capabilitiesByDomain('forms')).toHaveLength(5);
      expect(capabilitiesByDomain('records')).toHaveLength(8);
    });
  });

  // ============================================================
  // id 唯一性
  // ============================================================
  describe('id 唯一性', () => {
    it('所有能力 id 全局唯一', () => {
      const ids = CAPABILITY_GRAPH.map(c => c.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(dupes, `重复 id: ${dupes.join(', ')}`).toEqual([]);
    });

    it('id 命名遵循 {domain_prefix}.{name} 规范', () => {
      for (const cap of CAPABILITY_GRAPH) {
        // id 至少含一个点，且点前片段与域有合理关联
        expect(cap.id).toMatch(/^[a-z_]+\.[a-z_0-9]+$/);
      }
    });
  });

  // ============================================================
  // ruleActions 合法性
  // ============================================================
  describe('ruleActions 合法性', () => {
    const validSet = new Set<string>(VALID_RULE_ACTIONS);

    it('VALID_RULE_ACTIONS 恰好 26 个（与 rule-engine handler 1:1）', () => {
      expect(VALID_RULE_ACTIONS).toHaveLength(26);
      // 自身无重复
      expect(new Set(VALID_RULE_ACTIONS).size).toBe(26);
    });

    it('所有能力的 ruleActions 都在 26 种合法 action 内', () => {
      const invalid: string[] = [];
      for (const cap of CAPABILITY_GRAPH) {
        for (const action of cap.ruleActions) {
          if (!validSet.has(action)) invalid.push(`${cap.id} → ${action}`);
        }
      }
      expect(invalid, `非法 action: ${invalid.join('; ')}`).toEqual([]);
    });

    it('26 个 action 全部被至少一个能力引用（无死 action）', () => {
      const used = new Set<string>();
      for (const cap of CAPABILITY_GRAPH) {
        for (const action of cap.ruleActions) used.add(action);
      }
      const unused = VALID_RULE_ACTIONS.filter(a => !used.has(a));
      expect(unused, `未被任何能力引用的 action: ${unused.join(', ')}`).toEqual([]);
    });
  });

  // ============================================================
  // prerequisites 引用完整性
  // ============================================================
  describe('prerequisites 引用完整性', () => {
    it('所有 prerequisites 引用的 id 都存在', () => {
      const allIds = new Set(CAPABILITY_GRAPH.map(c => c.id));
      const dangling: string[] = [];
      for (const cap of CAPABILITY_GRAPH) {
        for (const pre of cap.prerequisites || []) {
          if (!allIds.has(pre)) dangling.push(`${cap.id} → ${pre}`);
        }
      }
      expect(dangling, `悬空 prerequisite: ${dangling.join('; ')}`).toEqual([]);
    });

    it('prerequisites 不自引用', () => {
      const selfRef = CAPABILITY_GRAPH.filter(c => c.prerequisites?.includes(c.id));
      expect(selfRef, `自引用: ${selfRef.map(c => c.id).join(', ')}`).toEqual([]);
    });
  });

  // ============================================================
  // scorable 与 ruleTemplate 一致性
  // ============================================================
  describe('scorable 与 ruleTemplate 一致性', () => {
    it('scorable=auto 的能力至少有一个非 null ruleTemplate', () => {
      const noTemplate: string[] = [];
      for (const cap of CAPABILITY_GRAPH) {
        if (cap.scorable === 'auto') {
          const hasTemplate = cap.examPatterns.some(p => p.ruleTemplate !== null);
          if (!hasTemplate) noTemplate.push(cap.id);
        }
      }
      expect(noTemplate, `auto 但无可执行 ruleTemplate: ${noTemplate.join(', ')}`).toEqual([]);
    });

    it('scorable=manual 的能力 ruleTemplate 全为 null', () => {
      const bad = CAPABILITY_GRAPH
        .filter(c => c.scorable === 'manual')
        .filter(c => c.examPatterns.some(p => p.ruleTemplate !== null));
      expect(bad, `manual 不应有 ruleTemplate: ${bad.map(c => c.id).join(', ')}`).toEqual([]);
    });

    it('scorable=needsReview 的能力允许有/无 ruleTemplate', () => {
      // needsReview 的语义：可自动判 + 人工复核，故 ruleTemplate 可有可无
      const needsReview = CAPABILITY_GRAPH.filter(c => c.scorable === 'needsReview');
      expect(needsReview.length).toBeGreaterThan(0);
      // 不做强制断言，只确保该分类存在
    });
  });

  // ============================================================
  // ruleTemplate action 与能力 ruleActions 一致性
  // ============================================================
  describe('ruleTemplate action 合法性', () => {
    it('每个 ruleTemplate 的 action 都在该能力的 ruleActions 内', () => {
      const violations: string[] = [];
      for (const cap of CAPABILITY_GRAPH) {
        const allowed = new Set(cap.ruleActions);
        for (const pattern of cap.examPatterns) {
          if (pattern.ruleTemplate && !allowed.has(pattern.ruleTemplate.action)) {
            violations.push(`${cap.id} 的 pattern「${pattern.title}」用了未声明的 action ${pattern.ruleTemplate.action}`);
          }
        }
      }
      expect(violations, `ruleTemplate action 越界: ${violations.join('; ')}`).toEqual([]);
    });

    it('每个 ruleTemplate 的 paramResolvers 至少声明 param 与 (from|value) 之一', () => {
      const bad: string[] = [];
      for (const cap of CAPABILITY_GRAPH) {
        for (const pattern of cap.examPatterns) {
          if (!pattern.ruleTemplate) continue;
          for (const r of pattern.ruleTemplate.paramResolvers) {
            if (!r.from && r.value === undefined) {
              bad.push(`${cap.id} resolver param=${r.param} 缺少 from/value`);
            }
          }
        }
      }
      expect(bad, `不完整 resolver: ${bad.join('; ')}`).toEqual([]);
    });
  });

  // ============================================================
  // 查询工具
  // ============================================================
  describe('查询工具', () => {
    it('findCapability 命中已知 id', () => {
      expect(findCapability('table.create')?.name).toBe('创建工作表');
      expect(findCapability('field.single_select')?.domain).toBe('fields');
    });

    it('findCapability 对未知 id 返回 undefined', () => {
      expect(findCapability('not.exist')).toBeUndefined();
    });

    it('capabilitiesByDomain 仅返回该域的能力', () => {
      const forms = capabilitiesByDomain('forms');
      expect(forms).toHaveLength(5);
      expect(forms.every(c => c.domain === 'forms')).toBe(true);
    });
  });
});
