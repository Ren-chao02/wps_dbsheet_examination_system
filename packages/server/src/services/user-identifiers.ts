import { prisma } from '../config/prisma';

/**
 * 登录标识的「全局命名空间」守卫。
 *
 * 登录按 username → studentId → employeeId 解析；如果允许跨列重复，
 * 某人的登录名就可能遮住另一人的学号/工号（username 优先），
 * 导致对方用学号登录却进了别人的账号。
 *
 * 三个字段各自有唯一约束，但数据库没有跨列唯一约束，所以写库前统一查一次。
 * 并发窗口很小；管理端建号是低频操作，这里不做串行化事务。
 */
export interface IdentifierConflict {
  id: string;
  username: string;
  studentId: string | null;
  employeeId: string | null;
  matchedField: 'username' | 'studentId' | 'employeeId';
}

type UserFinder = {
  user: {
    findFirst: typeof prisma.user.findFirst;
  };
};

export async function findIdentifierConflict(
  identifier: string,
  excludeUserId?: string,
  client: UserFinder = prisma,
): Promise<IdentifierConflict | null> {
  const conflict = await client.user.findFirst({
    where: {
      OR: [
        { username: identifier },
        { studentId: identifier },
        { employeeId: identifier },
      ],
      ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
    },
    select: { id: true, username: true, studentId: true, employeeId: true },
  });

  if (!conflict) return null;

  const matchedField: IdentifierConflict['matchedField'] =
    conflict.username === identifier
      ? 'username'
      : conflict.studentId === identifier
        ? 'studentId'
        : 'employeeId';

  return { ...conflict, matchedField };
}

export function identifierConflictMessage(conflict: IdentifierConflict): string {
  // 学生/教师的 username 是从学号/工号派生的；按业务语义给出更直观的字段名
  const label =
    conflict.studentId && conflict.username === conflict.studentId
      ? '学号'
      : conflict.employeeId && conflict.username === conflict.employeeId
        ? '工号'
        : conflict.matchedField === 'studentId'
          ? '学号'
          : conflict.matchedField === 'employeeId'
            ? '工号'
            : '登录名';
  return `该标识已被其他账号占用（与已有账号的${label}“${conflict[conflict.matchedField]}”冲突）`;
}
