/**
 * 千级开考压测 —— 隔离测试数据（可一键清理）
 * 前缀约定：用户名 9900xxxx / 题目与考试标题 [LOADTEST] / 考场编码 LT-
 */
import { prisma } from '../../packages/server/src/config/prisma';
import bcrypt from 'bcryptjs';
import fs from 'fs';

if (process.env.LT_CONFIRM !== 'yes') {
  console.error('拒绝执行：这会写入压测数据。确认请设置 LT_CONFIRM=yes（只操作 9900* / [LOADTEST] / LT- 前缀数据）');
  process.exit(1);
}
const N = Number(process.env.LT_STUDENTS || 1000);
const PASSWORD = process.env.LT_PASSWORD;
if (!PASSWORD) {
  console.error('必须通过 LT_PASSWORD=<压测学生统一密码> 指定密码（不写入仓库）');
  process.exit(1);
}
const STUDENT_FROM = 99000001;
const STATE = '/tmp/loadtest-state.json';

async function cleanup() {
  const exams = await prisma.exam.findMany({ where: { title: { startsWith: '[LOADTEST]' } }, select: { id: true } });
  const examIds = exams.map(e => e.id);
  const users = await prisma.user.findMany({ where: { username: { startsWith: '9900' } }, select: { id: true } });
  const userIds = users.map(u => u.id);

  if (examIds.length) {
    await prisma.submissionDetail.deleteMany({ where: { submission: { examId: { in: examIds } } } }).catch(() => {});
    await prisma.examSession.deleteMany({ where: { examId: { in: examIds } } }).catch(() => {});
    await prisma.studentSubmission.deleteMany({ where: { examId: { in: examIds } } }).catch(() => {});
    await prisma.studentExamQuestion.deleteMany({ where: { examId: { in: examIds } } }).catch(() => {});
    await prisma.examQuestion.deleteMany({ where: { examId: { in: examIds } } }).catch(() => {});
    await prisma.examPaperGeneration.deleteMany({ where: { examId: { in: examIds } } }).catch(() => {});
    await prisma.examRoomStudent.deleteMany({ where: { assignment: { examId: { in: examIds } } } }).catch(() => {});
    await prisma.examRoomAssignment.deleteMany({ where: { examId: { in: examIds } } }).catch(() => {});
    await prisma.exam.deleteMany({ where: { id: { in: examIds } } }).catch(() => {});
  }
  await prisma.examRoom.deleteMany({ where: { code: { startsWith: 'LT-' } } }).catch(() => {});
  await prisma.question.deleteMany({ where: { title: { startsWith: '[LOADTEST]' } } }).catch(() => {});
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  return { examIds, users: userIds.length };
}

(async () => {
  const before = await cleanup();
  console.log('cleaned', JSON.stringify(before));

  const hash = await bcrypt.hash(PASSWORD, 10);
  const usernames = Array.from({ length: N }, (_, i) => String(STUDENT_FROM + i));
  await prisma.user.createMany({
    data: usernames.map((username, i) => ({
      username,
      passwordHash: hash,
      realName: `压测学生${i + 1}`,
      role: 'student' as const,
      studentId: username,
      accountStatus: 'ENABLED' as const,
    })),
    skipDuplicates: true,
  });
  const dbUsers = await prisma.user.findMany({
    where: { username: { in: usernames } },
    select: { id: true, username: true },
    orderBy: { username: 'asc' },
  });

  const questions = [];
  for (let i = 0; i < 5; i++) {
    const q = await prisma.question.create({
      data: {
        title: `[LOADTEST] 压测单选 ${i + 1}`,
        description: `压测题目 ${i + 1}`,
        type: 'single_choice',
        difficulty: 'easy',
        score: 20,
        status: 'published',
        answerRules: [],
        objectiveAnswer: {
          options: [
            { key: 'A', text: '选项 A' },
            { key: 'B', text: '选项 B' },
            { key: 'C', text: '选项 C' },
            { key: 'D', text: '选项 D' },
          ],
          correct: ['A'],
        },
        createdBy: null,
      },
    });
    questions.push(q);
  }

  const exam = await prisma.exam.create({
    data: {
      title: '[LOADTEST] 千级开考压测',
      description: '自动生成，请勿用于真实考试',
      mode: 'exam',
      durationMinutes: 60,
      totalScore: 100,
      passScore: 60,
      status: 'published',
      startTime: null,
      endTime: null,
      settings: {},
      createdBy: null,
      examQuestions: {
        create: questions.map((q, i) => ({
          questionId: q.id,
          sortOrder: i,
          scoreOverride: 20,
          slotType: 'fixed',
          slotIndex: i,
        })),
      },
    },
  });

  const room = await prisma.examRoom.create({
    data: { code: 'LT-ROOM-1', name: '压测考场', capacity: N, status: 'available' },
  });
  const assignment = await prisma.examRoomAssignment.create({
    data: { examId: exam.id, roomId: room.id },
  });
  await prisma.examRoomStudent.createMany({
    data: dbUsers.map((u, i) => ({
      assignmentId: assignment.id,
      studentId: u.id,
      seatNumber: i + 1,
    })),
  });

  const state = {
    examId: exam.id,
    roomId: room.id,
    assignmentId: assignment.id,
    questionIds: questions.map(q => q.id),
    students: dbUsers.length,
    studentFrom: STUDENT_FROM,
  };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log('seeded', JSON.stringify(state));
  await prisma.$disconnect();
})();
