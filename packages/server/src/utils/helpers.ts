/**
 * 工具函数
 */

/**
 * 简单的哈希函数，将字符串转为数字种子
 */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * 基于种子的伪随机数生成器 (Linear Congruential Generator)
 * 每次调用返回 [0, 1) 之间的数
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Fisher-Yates 洗牌算法（确定性版本）
 * 使用相同的种子和相同的输入数组，总是产生相同的输出
 */
export function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  const random = createSeededRandom(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
