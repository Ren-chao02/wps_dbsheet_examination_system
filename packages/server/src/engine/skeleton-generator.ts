/**
 * 题目骨架生成器
 *
 * 根据出题人勾选的能力，生成题目草稿（标题/描述/规则模板/建议分值）。
 * 生成的骨架是"草稿"，出题人可微调；其中 ruleTemplates 含占位符，
 * 后续由 AnswerReverser 用标准答案 Schema 填充为真实 answerRules。
 *
 * @see docs/superpowers/specs/2026-07-07-exam-authoring-assist.md §3.2、§4.4
 */
import {
  findCapability,
  type Capability,
  type CapabilityDomain,
  type RuleTemplate,
  type Scorable,
} from '../data/capability-graph';

/** 骨架生成器输入 */
export interface SkeletonInput {
  /** 勾选的能力 id 列表 */
  capabilityIds: string[];
  /** 可选难度覆盖；不传则取所选能力中最高的默认难度 */
  difficulty?: 'easy' | 'medium' | 'hard';
}

/** 骨架生成器输出 */
export interface QuestionSkeleton {
  /** 草稿标题 */
  title: string;
  /** 草稿描述（操作步骤） */
  description: string;
  /** 难度 */
  difficulty: 'easy' | 'medium' | 'hard';
  /** 建议总分值 */
  suggestedScore: number;
  /** 收集到的规则模板（含占位符，待反向器填充） */
  ruleTemplates: RuleTemplate[];
  /** 所选能力摘要（供前端展示） */
  selectedCapabilities: Array<{
    id: string;
    name: string;
    domain: CapabilityDomain;
    scorable: Scorable;
  }>;
  /** 警告信息（如含 needsReview/manual 能力、未知 id） */
  warnings: string[];
}

/** 难度排序权重 */
const DIFFICULTY_WEIGHT: Record<string, number> = { easy: 1, medium: 2, hard: 3 };
const WEIGHT_TO_DIFFICULTY: Record<number, 'easy' | 'medium' | 'hard'> = {
  1: 'easy', 2: 'medium', 3: 'hard',
};

/** 建议分值上限，避免勾选过多能力导致分值爆炸 */
const MAX_SUGGESTED_SCORE = 100;

export class SkeletonGenerator {
  /**
   * 根据勾选能力生成题目骨架
   *
   * 步骤：
   * 1. 查找能力（未知 id 记入 warnings）
   * 2. 拼接标题（单能力用名称，多能力用"并/等综合操作"）
   * 3. 生成描述（收集各能力的首个考法描述作为操作步骤）
   * 4. 收集所有非 null ruleTemplate
   * 5. 汇总建议分值（各能力首个考法分值之和，上限 100）
   * 6. 计算难度（输入覆盖 > 所选能力最高默认难度）
   * 7. 标注警告（needsReview / manual / 未知 id）
   */
  generate(input: SkeletonInput): QuestionSkeleton {
    const { capabilityIds, difficulty } = input;
    const warnings: string[] = [];

    // 1. 查找能力，跳过未知 id
    const capabilities: Capability[] = [];
    for (const id of capabilityIds) {
      const cap = findCapability(id);
      if (!cap) {
        warnings.push(`未知能力 id：${id}（已跳过）`);
        continue;
      }
      capabilities.push(cap);
    }

    // 空能力列表 → 返回空骨架
    if (capabilities.length === 0) {
      return {
        title: '自定义操作题',
        description: '',
        difficulty: difficulty || 'medium',
        suggestedScore: 0,
        ruleTemplates: [],
        selectedCapabilities: [],
        warnings,
      };
    }

    // 2. 拼接标题
    const title = this.buildTitle(capabilities);

    // 3. 生成描述
    const description = this.buildDescription(capabilities);

    // 4. 收集 ruleTemplates
    const ruleTemplates = this.collectRuleTemplates(capabilities);

    // 5. 汇总建议分值
    const suggestedScore = this.sumSuggestedScore(capabilities);

    // 6. 计算难度
    const resolvedDifficulty = difficulty || this.maxDifficulty(capabilities);

    // 7. 标注 scorable 警告
    this.appendScorableWarnings(capabilities, warnings);

    return {
      title,
      description,
      difficulty: resolvedDifficulty,
      suggestedScore,
      ruleTemplates,
      selectedCapabilities: capabilities.map(c => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        scorable: c.scorable,
      })),
      warnings,
    };
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 拼接标题：
   * - 1 个能力：直接用名称
   * - 2 个能力：name1 并 name2
   * - 3+ 个能力：name1、name2、name3 等综合操作
   */
  private buildTitle(caps: Capability[]): string {
    const names = caps.map(c => c.name);
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]}并${names[1]}`;
    return `${names.slice(0, 3).join('、')}等综合操作`;
  }

  /**
   * 生成描述：收集各能力首个考法描述作为操作步骤
   */
  private buildDescription(caps: Capability[]): string {
    const steps = caps
      .map((cap, i) => {
        const pattern = cap.examPatterns[0];
        if (!pattern) return null;
        return `${i + 1}. ${pattern.description}（${cap.name}，建议 ${pattern.suggestedScore} 分）`;
      })
      .filter((s): s is string => s !== null);

    if (steps.length === 0) {
      return '请描述本题要求学生完成的操作。';
    }
    return `本题要求学生完成以下操作：\n${steps.join('\n')}`;
  }

  /**
   * 收集所有非 null ruleTemplate（去重：同 action 只保留首个）
   */
  private collectRuleTemplates(caps: Capability[]): RuleTemplate[] {
    const seen = new Set<string>();
    const templates: RuleTemplate[] = [];
    for (const cap of caps) {
      for (const pattern of cap.examPatterns) {
        if (!pattern.ruleTemplate) continue;
        const key = pattern.ruleTemplate.action;
        if (seen.has(key)) continue;
        seen.add(key);
        templates.push(pattern.ruleTemplate);
      }
    }
    return templates;
  }

  /**
   * 汇总建议分值：各能力首个考法分值之和，上限 100
   */
  private sumSuggestedScore(caps: Capability[]): number {
    const total = caps.reduce((sum, cap) => {
      const pattern = cap.examPatterns[0];
      return sum + (pattern?.suggestedScore || 0);
    }, 0);
    return Math.min(total, MAX_SUGGESTED_SCORE);
  }

  /**
   * 取所选能力中最高的默认难度
   */
  private maxDifficulty(caps: Capability[]): 'easy' | 'medium' | 'hard' {
    const maxWeight = caps.reduce((max, cap) => {
      const w = DIFFICULTY_WEIGHT[cap.defaultDifficulty] || 0;
      return Math.max(max, w);
    }, 0);
    return WEIGHT_TO_DIFFICULTY[maxWeight] || 'medium';
  }

  /**
   * 根据 scorable 类型追加警告
   */
  private appendScorableWarnings(caps: Capability[], warnings: string[]): void {
    const needsReview = caps.filter(c => c.scorable === 'needsReview');
    const manual = caps.filter(c => c.scorable === 'manual');

    if (needsReview.length > 0) {
      warnings.push(
        `以下能力需人工复核：${needsReview.map(c => c.name).join('、')}`
      );
    }
    if (manual.length > 0) {
      warnings.push(
        `以下能力只能人工判分（无自动规则）：${manual.map(c => c.name).join('、')}`
      );
    }
  }
}

/** 单例导出，供路由层直接使用 */
export const skeletonGenerator = new SkeletonGenerator();
