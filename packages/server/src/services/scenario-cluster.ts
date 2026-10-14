/**
 * 场景归链：把一道链的题（如「员工信息表」20 题）聚在一起并排出教学顺序。
 *
 * 为什么用「表」当锚点：题面里的表名是判分与提示的唯一稳定标识（判分就是按表名找表）。
 * 归不进去的（跨链 / 无表信息 / 依赖成环）一律进待确认清单——不猜，交教师指定。
 */

export interface ClusterInput {
  id: string;
  title: string;
  /** 本题引用的表（前一题的产物），来自前置契约 */
  requires: string[];
  /** 本题创建的表，来自前置契约 */
  creates: string[];
}

export interface ClusterAssignment { id: string; scenario: string; scenarioOrder: number }
export interface ClusterPending { id: string; reason: string }
export interface ClusterResult {
  assignments: ClusterAssignment[];
  pending: ClusterPending[];
  scenarios: { key: string; questionIds: string[] }[];
}

/** 并查集：把"同一道题创建的表"并成一条链 */
class Dsu {
  private parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x);
    if (p === undefined) { this.parent.set(x, x); return x; }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function clusterScenarios(items: ClusterInput[]): ClusterResult {
  const dsu = new Dsu();
  // 1) 同一道题创建的多张表并入同一条链
  for (const it of items) {
    for (let i = 1; i < it.creates.length; i++) dsu.union(it.creates[0], it.creates[i]);
  }

  /** 某张表是否被某道题创建过（用于判断"本题所需的表归谁管"） */
  const creatorOf = new Map<string, string>();
  for (const it of items) for (const t of it.creates) if (!creatorOf.has(t)) creatorOf.set(t, it.id);

  // 2) 归属
  const chainOf = new Map<string, string>();          // questionId → 链根
  const pending: ClusterPending[] = [];
  for (const it of items) {
    if (it.creates.length > 0) {
      // 既创建又需要别的表 = 这题把它们用在一起了 → 这些表属于同一场景，并链。
      // （只 requires、不 creates 的跨链题仍进人工清单，不在这里并 —— 那才是要人定的）
      for (const t of it.requires) dsu.union(it.creates[0], t);
      chainOf.set(it.id, dsu.find(it.creates[0]));
      continue;
    }

    const owners = [...new Set(it.requires.filter(t => creatorOf.has(t)).map(t => dsu.find(t)))];
    if (it.requires.length === 0) {
      pending.push({ id: it.id, reason: '规则里没有表信息，无法归链' });
    } else if (owners.length === 0) {
      // 需要的表没人创建 → 本题自成链根（题面自建场景，如销售报表）
      for (let i = 1; i < it.requires.length; i++) dsu.union(it.requires[0], it.requires[i]);
      chainOf.set(it.id, dsu.find(it.requires[0]));
    } else if (owners.length === 1) {
      chainOf.set(it.id, owners[0]);
    } else {
      const tables = [...it.requires].sort().join('、');
      pending.push({ id: it.id, reason: `跨链：需要 ${tables}（分属两条链），请人工指定场景` });
    }
  }

  // 3) 链名 + 链内拓扑排序
  const tableOfRoot = new Map<string, string[]>();
  for (const it of items) {
    for (const t of [...it.creates, ...it.requires]) {
      const root = dsu.find(t);
      if (!tableOfRoot.has(root)) tableOfRoot.set(root, []);
      tableOfRoot.get(root)!.push(t);
    }
  }

  const byChain = new Map<string, ClusterInput[]>();
  for (const it of items) {
    const root = chainOf.get(it.id);
    if (!root) continue;
    if (!byChain.has(root)) byChain.set(root, []);
    byChain.get(root)!.push(it);
  }

  const assignments: ClusterAssignment[] = [];
  const scenarios: { key: string; questionIds: string[] }[] = [];

  for (const [root, members] of byChain) {
    const key = [...new Set(tableOfRoot.get(root) ?? [])].sort().join(' + ');
    const ordered = topoSort(members, pending);
    // 依赖成环时 topoSort 返回 null → 用 title 兜底，但仍标进待确认
    const finalOrder = ordered ?? [...members].sort((a, b) => a.title.localeCompare(b.title));
    finalOrder.forEach((it, i) => assignments.push({ id: it.id, scenario: key, scenarioOrder: i + 1 }));
    scenarios.push({ key, questionIds: finalOrder.map(it => it.id) });
  }

  // 输出保持首次出现顺序（链按首次出现、链内按已排好的顺序、pending 按入队顺序）。
  // 这里**不要**按 key/id 重排：中文 localeCompare 依赖语言环境，会让链顺序在不同机器上漂移，
  // 而链顺序是学生直接看到的。输入顺序 = 调用方给的顺序（回填脚本按分类 sortOrder → createdAt 取数）。
  return { assignments, pending, scenarios };
}

/**
 * 链内拓扑排序：creates(A) ∩ requires(B) ≠ ∅ ⇒ A 在 B 前。
 * 同层按**输入顺序**取（调用方传入的就是教学顺序）；不用 title 排序 —— 中文 localeCompare
 * 与语言环境有关，会让顺序在不同环境下漂移。成环返回 null，由调用方兜底并标进待确认。
 */
function topoSort(members: ClusterInput[], pending: ClusterPending[]): ClusterInput[] | null {
  const index = new Map(members.map((m, i) => [m.id, i]));
  const byOrder = (a: ClusterInput, b: ClusterInput) => index.get(a.id)! - index.get(b.id)!;
  const indegree = new Map<string, number>();
  const edges = new Map<string, string[]>();   // 前置题 → 后继题
  const byId = new Map(members.map(m => [m.id, m]));
  for (const m of members) { indegree.set(m.id, 0); edges.set(m.id, []); }

  for (const b of members) {
    for (const a of members) {
      if (a.id === b.id) continue;
      const shares = a.creates.some(t => b.requires.includes(t));
      if (shares) { edges.get(a.id)!.push(b.id); indegree.set(b.id, (indegree.get(b.id) ?? 0) + 1); }
    }
  }

  const ready = members.filter(m => (indegree.get(m.id) ?? 0) === 0).sort(byOrder);
  const out: ClusterInput[] = [];
  while (ready.length > 0) {
    const cur = ready.shift()!;
    out.push(cur);
    for (const next of edges.get(cur.id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) { ready.push(byId.get(next)!); ready.sort(byOrder); }
    }
  }

  if (out.length !== members.length) {
    // 只标"卡住"的成员（入度没有归零的），不是整条链 —— 19 题的链里有一个 2 题环，
    // 整链标记会在人工清单里刷 19 条噪声。卡住的集合含环本身 + 受环影响的下游题。
    for (const m of members) {
      if ((indegree.get(m.id) ?? 0) > 0) pending.push({ id: m.id, reason: '依赖成环，顺序需人工确认' });
    }
    return null;
  }
  return out;
}
