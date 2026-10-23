/**
 * 稳态压测辅助：为压测学生直接落库 in_progress 答卷（不经过 start-wps HTTP），
 * 让 k6 的 steady 场景可以只关心心跳/自动保存。
 *
 * 只操作 [LOADTEST] 考试与 9900* 学生；必须显式 LT_CONFIRM=yes。
 */
import { prisma } from '../../packages/server/src/config/prisma';
import fs from 'fs';

if (process.env.LT_CONFIRM !== 'yes') {
  console.error('拒绝执行：确认请设置 LT_CONFIRM=yes（只操作 [LOADTEST]/9900* 数据）');
  process.exit(1);
}
const STATE = process.env.LT_STATE || '/tmp/loadtest-state.json';
const LIMIT = Number(process.env.LT_SUBMIT_STUDENTS || 0);

(async () => {
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const examId: string = state.examId;

  const students = await prisma.user.findMany({
    where: { username: { startsWith: '9900' } },
    select: { id: true, username: true },
    orderBy: { username: 'asc' },
    ...(LIMIT > 0 ? { take: LIMIT } : {}),
  });

  let created = 0;
  for (const s of students) {
    const exists = await prisma.studentSubmission.findUnique({
      where: { examId_studentId: { examId, studentId: s.id } },
      select: { id: true, status: true },
    });
    if (exists?.status === 'in_progress') continue;

    const rows = await prisma.studentExamQuestion.findMany({
      where: { examId, studentId: s.id },
      select: { questionId: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (rows.length === 0) continue; // 未预生成的学生跳过（steady 需要已有卷）

    const submission = await prisma.studentSubmission.create({
      data: {
        examId,
        studentId: s.id,
        status: 'in_progress',
        startedAt: new Date(),
        tableSpaceId: '',
        details: { create: rows.map(r => ({ questionId: r.questionId })) },
      },
    });
    await prisma.examSession.create({
      data: { submissionId: submission.id, studentId: s.id, examId, ipAddress: null },
    }).catch(() => { /* 会话失败不阻断 */ });
    created += 1;
  }

  console.log(JSON.stringify({ examId, students: students.length, createdSubmissions: created }));
  await prisma.$disconnect();
})();
