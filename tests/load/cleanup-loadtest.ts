import { prisma } from '../../packages/server/src/config/prisma';
if (process.env.LT_CONFIRM !== 'yes') {
  console.error('拒绝执行：确认请设置 LT_CONFIRM=yes（只删除 9900* / [LOADTEST] / LT- 前缀数据）');
  process.exit(1);
}
(async () => {
  const exams = await prisma.exam.findMany({ where: { title: { startsWith: '[LOADTEST]' } }, select: { id: true } });
  const examIds = exams.map(e => e.id);
  const users = await prisma.user.findMany({ where: { username: { startsWith: '9900' } }, select: { id: true } });
  const userIds = users.map(u => u.id);
  console.log('targets', JSON.stringify({ exams: examIds.length, users: userIds.length }));
  if (examIds.length) {
    console.log('behaviorLogs', (await prisma.studentBehaviorLog.deleteMany({ where: { examId: { in: examIds } } })).count);
    console.log('details', (await prisma.submissionDetail.deleteMany({ where: { submission: { examId: { in: examIds } } } })).count);
    console.log('sessions', (await prisma.examSession.deleteMany({ where: { examId: { in: examIds } } })).count);
    console.log('submissions', (await prisma.studentSubmission.deleteMany({ where: { examId: { in: examIds } } })).count);
    console.log('snapshots', (await prisma.studentExamQuestion.deleteMany({ where: { examId: { in: examIds } } })).count);
    console.log('examQuestions', (await prisma.examQuestion.deleteMany({ where: { examId: { in: examIds } } })).count);
    console.log('generation', (await prisma.examPaperGeneration.deleteMany({ where: { examId: { in: examIds } } })).count);
    console.log('roomStudents', (await prisma.examRoomStudent.deleteMany({ where: { assignment: { examId: { in: examIds } } } })).count);
    console.log('assignments', (await prisma.examRoomAssignment.deleteMany({ where: { examId: { in: examIds } } })).count);
    console.log('exams', (await prisma.exam.deleteMany({ where: { id: { in: examIds } } })).count);
  }
  console.log('rooms', (await prisma.examRoom.deleteMany({ where: { code: { startsWith: 'LT-' } } })).count);
  console.log('questions', (await prisma.question.deleteMany({ where: { title: { startsWith: '[LOADTEST]' } } })).count);
  console.log('users', (await prisma.user.deleteMany({ where: { id: { in: userIds } } })).count);
  const residual = {
    users: await prisma.user.count({ where: { username: { startsWith: '9900' } } }),
    exams: await prisma.exam.count({ where: { title: { startsWith: '[LOADTEST]' } } }),
    questions: await prisma.question.count({ where: { title: { startsWith: '[LOADTEST]' } } }),
    rooms: await prisma.examRoom.count({ where: { code: { startsWith: 'LT-' } } }),
  };
  console.log('residual', JSON.stringify(residual));
  await prisma.$disconnect();
})();
