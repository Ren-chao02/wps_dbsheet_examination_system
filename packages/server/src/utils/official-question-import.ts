/**
 * 官方题库（Excel）导入的纯逻辑：品牌中性化 / 答案解析 / 题目对象构建。
 *
 * 单抽成模块而不是塞在脚本里：这三步都有踩坑边界，用单元测试锁死，脚本只做 IO——
 * - 判断题答案在原始数据里有 √ / × / 正确 / 错误 多种写法；
 * - 多选题答案有 "ABCDEFG"（连写）与 "A、B、C"（顿号分隔）两种格式；
 * - 品牌词替换必须"整词优先再兜底"：先替「飞书多维表格」，否则连着残留的「飞书」会被拆坏。
 */

export type ObjectiveType = 'single_choice' | 'multiple_choice' | 'true_false';

/** 官方题默认分值：单选/判断 2 分、多选 3 分（与系统里客观题的常用配置一致，导入后可在界面调整） */
export const OBJECTIVE_SCORES: Record<ObjectiveType, number> = {
  single_choice: 2,
  multiple_choice: 3,
  true_false: 2,
};

/** title 字段上限（与 questionSchema 的 max(512) 一致）；超长才启用 description 兜底 */
const TITLE_MAX = 512;

/**
 * 品牌中性化（用户口径：一并中性化）。
 * 先整体替换「飞书多维表格」→「多维表格」，再把其余「飞书」字样清掉：
 * 「关联飞书通讯录」→「关联通讯录」、「自动发飞书消息」→「自动发消息」、「飞书文档」→「文档」。
 */
export function neutralizeBrand(text: string): string {
  if (!text) return text;
  return text
    .replace(/飞书多维表格/g, '多维表格')
    .replace(/飞书\s*/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** 单选题答案："B" / "b." → 'B' */
export function parseSingleChoiceAnswer(raw: string): string {
  const m = String(raw).toUpperCase().match(/[A-Z]/);
  if (!m) throw new Error(`无法解析单选题答案: "${raw}"`);
  return m[0];
}

/** 多选题答案："ABCDEFG" 或 "A、B、C" → ['A','B','C']（去重升序） */
export function parseMultipleChoiceAnswer(raw: string): string[] {
  const letters = Array.from(new Set(String(raw).toUpperCase().match(/[A-Z]/g) ?? [])).sort();
  if (letters.length === 0) throw new Error(`无法解析多选题答案: "${raw}"`);
  return letters;
}

const TRUE_TOKENS = ['√', '✓', '正确', '对', '是', 'TRUE', 'T'];
const FALSE_TOKENS = ['×', '✗', 'X', '错误', '错', '否', 'FALSE', 'F'];

/** 判断题答案：√/正确/对/是 → 'A'（正确项）；×/错误/否 → 'B'（错误项），选项约定与编辑器一致 */
export function parseTrueFalseAnswer(raw: string): 'A' | 'B' {
  const t = String(raw).trim().toUpperCase();
  if (TRUE_TOKENS.some((k) => t === k.toUpperCase())) return 'A';
  if (FALSE_TOKENS.some((k) => t === k.toUpperCase())) return 'B';
  throw new Error(`无法解析判断题答案: "${raw}"`);
}

export interface OfficialQuestionInput {
  type: ObjectiveType;
  /** 题干原文（Excel「题目」列） */
  stem: string;
  /** 选项（保持原始 A/B/C… key） */
  options: Array<{ key: string; text: string }>;
  /** 正确答案（大写字母数组） */
  correct: string[];
  /** 解析（Excel「解析」列） */
  analysis?: string | null;
  /** 知识点（Excel「知识点」列；写进 tags 保留原始信息，不做分类映射） */
  knowledgePoint?: string | null;
}

/**
 * 构建官方题目的落库对象（source='official'，status=published，difficulty=medium）。
 *
 * title 用题干原文、description 置空：学生端把 title 渲染为题目大标题、description 渲染为
 * 题干卡片，两个字段都放题干会出现"标题即题干"的重复展示。超过 512 字的题干才把全文放进
 * description 兜底（title 截断），并保留完整内容。
 */
export function buildOfficialQuestion(input: OfficialQuestionInput) {
  const stem = neutralizeBrand(input.stem);
  if (!stem) throw new Error('题干为空');

  const options = input.options
    .map((o) => ({ key: String(o.key).toUpperCase(), text: neutralizeBrand(String(o.text)) }))
    .filter((o) => o.text.length > 0);

  if (options.length < 2) throw new Error(`有效选项少于 2 个：${stem.slice(0, 40)}`);
  const keys = options.map((o) => o.key);
  if (new Set(keys).size !== keys.length) throw new Error(`选项 key 重复：${stem.slice(0, 40)}`);

  const correct = Array.from(new Set(input.correct.map((c) => c.toUpperCase()))).sort();
  if (correct.length === 0) throw new Error(`没有正确答案：${stem.slice(0, 40)}`);
  const unknown = correct.filter((c) => !keys.includes(c));
  if (unknown.length > 0) throw new Error(`正确答案不在选项中（${unknown.join('/')}）：${stem.slice(0, 40)}`);
  if (input.type !== 'multiple_choice' && correct.length !== 1) {
    throw new Error(`单选/判断只能有 1 个正确项（得到 ${correct.length} 个）：${stem.slice(0, 40)}`);
  }

  const needDescription = stem.length > TITLE_MAX;

  return {
    title: needDescription ? stem.slice(0, TITLE_MAX - 1) + '…' : stem,
    description: needDescription ? stem : null,
    type: input.type,
    difficulty: 'medium' as const,
    score: OBJECTIVE_SCORES[input.type],
    objectiveAnswer: { options, correct },
    analysis: input.analysis ? neutralizeBrand(String(input.analysis)) : null,
    tags: input.knowledgePoint ? [neutralizeBrand(String(input.knowledgePoint))] : [],
    capabilityIds: [] as string[],
    answerRules: [] as unknown[],
    hints: null,
    status: 'published' as const,
    source: 'official',
    createdBy: null,
    teacherName: null,
  };
}
