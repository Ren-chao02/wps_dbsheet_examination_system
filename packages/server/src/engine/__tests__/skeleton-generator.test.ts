import { describe, it, expect } from 'vitest';
import { SkeletonGenerator, skeletonGenerator } from '../skeleton-generator';

/**
 * 骨架生成器单元测试
 *
 * @see docs/superpowers/specs/2026-07-07-exam-authoring-assist.md §5.2
 */
describe('SkeletonGenerator', () => {
  const gen = new SkeletonGenerator();

  // ============================================================
  // §5.2 空能力列表返回空骨架
  // ============================================================
  describe('空能力列表', () => {
    it('返回空骨架', () => {
      const skeleton = gen.generate({ capabilityIds: [] });
      expect(skeleton.title).toBe('自定义操作题');
      expect(skeleton.description).toBe('');
      expect(skeleton.suggestedScore).toBe(0);
      expect(skeleton.ruleTemplates).toEqual([]);
      expect(skeleton.selectedCapabilities).toEqual([]);
      expect(skeleton.warnings).toEqual([]);
    });

    it('空列表尊重传入的难度', () => {
      const skeleton = gen.generate({ capabilityIds: [], difficulty: 'hard' });
      expect(skeleton.difficulty).toBe('hard');
    });

    it('空列表默认难度为 medium', () => {
      const skeleton = gen.generate({ capabilityIds: [] });
      expect(skeleton.difficulty).toBe('medium');
    });
  });

  // ============================================================
  // §5.2 单域能力生成正确骨架
  // ============================================================
  describe('单域能力', () => {
    it('单个能力：标题用能力名', () => {
      const skeleton = gen.generate({ capabilityIds: ['table.create'] });
      expect(skeleton.title).toBe('创建工作表');
      expect(skeleton.selectedCapabilities).toHaveLength(1);
      expect(skeleton.selectedCapabilities[0]).toEqual({
        id: 'table.create',
        name: '创建工作表',
        domain: 'tables',
        scorable: 'auto',
      });
    });

    it('单个能力：收集 ruleTemplate', () => {
      const skeleton = gen.generate({ capabilityIds: ['table.create'] });
      expect(skeleton.ruleTemplates).toHaveLength(1);
      expect(skeleton.ruleTemplates[0].action).toBe('check_table_exists');
    });

    it('单个能力：建议分值取首个考法分值', () => {
      const skeleton = gen.generate({ capabilityIds: ['table.create'] });
      // table.create 首个考法 suggestedScore = 10
      expect(skeleton.suggestedScore).toBe(10);
    });

    it('单选字段能力：收集多个 ruleTemplate（check_field + check_field_options）', () => {
      const skeleton = gen.generate({ capabilityIds: ['field.single_select'] });
      const actions = skeleton.ruleTemplates.map(t => t.action);
      expect(actions).toContain('check_field');
      expect(actions).toContain('check_field_options');
      // single_select 有 2 个考法，分值 5+5=10
      // 但 sumSuggestedScore 只取首个考法分值
      expect(skeleton.suggestedScore).toBe(5);
    });

    it('描述包含操作步骤', () => {
      const skeleton = gen.generate({ capabilityIds: ['table.create'] });
      expect(skeleton.description).toContain('本题要求学生完成以下操作');
      expect(skeleton.description).toContain('1.');
      expect(skeleton.description).toContain('创建工作表');
    });

    it('难度取能力默认难度', () => {
      const skeleton = gen.generate({ capabilityIds: ['table.multi'] });
      // table.multi defaultDifficulty = 'hard'
      expect(skeleton.difficulty).toBe('hard');
    });

    it('传入难度覆盖能力默认难度', () => {
      const skeleton = gen.generate({
        capabilityIds: ['table.create'],
        difficulty: 'hard',
      });
      expect(skeleton.difficulty).toBe('hard');
    });
  });

  // ============================================================
  // §5.2 多域能力生成组合标题
  // ============================================================
  describe('多域能力', () => {
    it('两个能力：用"并"连接标题', () => {
      const skeleton = gen.generate({
        capabilityIds: ['table.create', 'field.single_select'],
      });
      expect(skeleton.title).toBe('创建工作表并单选字段');
    });

    it('三个能力：用"、等综合操作"连接', () => {
      const skeleton = gen.generate({
        capabilityIds: ['table.create', 'field.single_select', 'view.grid'],
      });
      expect(skeleton.title).toBe('创建工作表、单选字段、表格视图等综合操作');
    });

    it('多域能力：selectedCapabilities 来自不同域', () => {
      const skeleton = gen.generate({
        capabilityIds: ['table.create', 'field.single_select'],
      });
      const domains = skeleton.selectedCapabilities.map(c => c.domain);
      expect(domains).toContain('tables');
      expect(domains).toContain('fields');
    });

    it('多域能力：建议分值为各能力首个考法分值之和', () => {
      const skeleton = gen.generate({
        capabilityIds: ['table.create', 'field.single_select'],
      });
      // table.create 首考法 10 + field.single_select 首考法 5 = 15
      expect(skeleton.suggestedScore).toBe(15);
    });

    it('多域能力：难度取最高默认难度', () => {
      const skeleton = gen.generate({
        capabilityIds: ['table.create', 'table.multi'], // easy + hard
      });
      expect(skeleton.difficulty).toBe('hard');
    });

    it('多域能力：ruleTemplates 去重（同 action 只保留首个）', () => {
      // field.text 和 field.number 都用 check_field
      const skeleton = gen.generate({
        capabilityIds: ['field.text', 'field.number'],
      });
      const actions = skeleton.ruleTemplates.map(t => t.action);
      expect(actions).toEqual(['check_field']); // 去重后只剩一个
    });
  });

  // ============================================================
  // 未知 id 与警告
  // ============================================================
  describe('未知 id 与警告', () => {
    it('未知 id 记入 warnings 且不影响其他能力', () => {
      const skeleton = gen.generate({
        capabilityIds: ['table.create', 'not.exist'],
      });
      expect(skeleton.selectedCapabilities).toHaveLength(1);
      expect(skeleton.warnings).toContain('未知能力 id：not.exist（已跳过）');
    });

    it('全为未知 id 时返回空骨架 + 警告', () => {
      const skeleton = gen.generate({
        capabilityIds: ['fake1', 'fake2'],
      });
      expect(skeleton.title).toBe('自定义操作题');
      expect(skeleton.suggestedScore).toBe(0);
      expect(skeleton.warnings).toHaveLength(2);
    });

    it('含 needsReview 能力时追加警告', () => {
      const skeleton = gen.generate({
        capabilityIds: ['table.create', 'table.primary_field'],
      });
      // table.primary_field scorable = needsReview
      const reviewWarning = skeleton.warnings.find(w => w.includes('人工复核'));
      expect(reviewWarning).toBeTruthy();
      expect(reviewWarning).toContain('设置主字段');
    });

    it('含 manual 能力时追加警告', () => {
      const skeleton = gen.generate({
        capabilityIds: ['table.create', 'view.hide_fields'],
      });
      // view.hide_fields scorable = manual
      const manualWarning = skeleton.warnings.find(w => w.includes('人工判分'));
      expect(manualWarning).toBeTruthy();
      expect(manualWarning).toContain('隐藏字段');
    });
  });

  // ============================================================
  // 单例导出
  // ============================================================
  describe('单例导出', () => {
    it('skeletonGenerator 单例可用', () => {
      const skeleton = skeletonGenerator.generate({ capabilityIds: ['table.create'] });
      expect(skeleton.title).toBe('创建工作表');
    });
  });
});
