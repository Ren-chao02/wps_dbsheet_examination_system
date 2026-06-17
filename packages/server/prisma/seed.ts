import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始填充种子数据...');

  // Clean existing data
  await prisma.verificationResult.deleteMany();
  await prisma.submissionDetail.deleteMany();
  await prisma.studentSubmission.deleteMany();
  await prisma.examSession.deleteMany();
  await prisma.examQuestion.deleteMany();
  await prisma.exam.deleteMany();
  await prisma.question.deleteMany();
  await prisma.questionCategory.deleteMany();
  await prisma.user.deleteMany();
  await prisma.systemRolePermission.deleteMany();
  await prisma.systemRole.deleteMany();
  await prisma.importTask.deleteMany();

  const passwordHash = await bcrypt.hash('123456', 10);

  // ============================================================
  // 创建预设 SystemRole
  // ============================================================
  console.log('🔧 创建预设角色...');

  const systemRoleAdmin = await prisma.systemRole.create({
    data: {
      roleCode: 'ADMIN',
      roleName: '学校管理员',
      roleType: 'preset',
      description: '拥有所有模块的操作权限',
      permissions: {
        create: [
          { moduleCode: 'QUESTION_BANK' },
          { moduleCode: 'EXAM_MANAGEMENT' },
          { moduleCode: 'STUDENT_MANAGEMENT' },
          { moduleCode: 'INVIGILATION' },
          { moduleCode: 'GRADE_MANAGEMENT' },
          { moduleCode: 'SYSTEM_MANAGEMENT' },
          { moduleCode: 'IMPORT_EXPORT' },
        ],
      },
    },
  });

  const systemRoleTeacher = await prisma.systemRole.create({
    data: {
      roleCode: 'TEACHER',
      roleName: '老师',
      roleType: 'preset',
      description: '拥有除系统管理外的所有操作权限',
      permissions: {
        create: [
          { moduleCode: 'QUESTION_BANK' },
          { moduleCode: 'EXAM_MANAGEMENT' },
          { moduleCode: 'STUDENT_MANAGEMENT' },
          { moduleCode: 'INVIGILATION' },
          { moduleCode: 'GRADE_MANAGEMENT' },
          { moduleCode: 'IMPORT_EXPORT' },
        ],
      },
    },
  });

  const systemRoleInvigilator = await prisma.systemRole.create({
    data: {
      roleCode: 'INVIGILATOR',
      roleName: '监考员',
      roleType: 'preset',
      description: '仅拥有监考管理权限',
      permissions: {
        create: [
          { moduleCode: 'INVIGILATION' },
        ],
      },
    },
  });

  console.log('✅ 预设角色创建完成');

  // Create users
  const admin = await prisma.user.create({
    data: {
      username: 'admin',
      passwordHash,
      realName: '系统管理员',
      role: 'admin',
      email: 'admin@example.com',
      gender: 'UNSET',
      remark: '系统预置管理员账户',
      systemRoleId: systemRoleAdmin.id,
    },
  });

  const teacher = await prisma.user.create({
    data: {
      username: 'teacher1',
      passwordHash,
      realName: '王老师',
      role: 'teacher',
      email: 'teacher@example.com',
      gender: 'MALE',
      remark: '预置教师账户',
      systemRoleId: systemRoleTeacher.id,
    },
  });

  const student1 = await prisma.user.create({
    data: {
      username: 'student1',
      passwordHash,
      realName: '张三',
      role: 'student',
      email: 'zhangsan@example.com',
    },
  });

  const student2 = await prisma.user.create({
    data: {
      username: 'student2',
      passwordHash,
      realName: '李四',
      role: 'student',
      email: 'lisi@example.com',
    },
  });

  console.log('✅ 用户创建完成');

  // Create categories
  const catBasic = await prisma.questionCategory.create({
    data: { name: '基础操作', sortOrder: 1 },
  });
  const catField = await prisma.questionCategory.create({
    data: { name: '字段操作', sortOrder: 2, parentId: catBasic.id },
  });
  const catView = await prisma.questionCategory.create({
    data: { name: '视图操作', sortOrder: 3, parentId: catBasic.id },
  });
  const catForm = await prisma.questionCategory.create({
    data: { name: '表单操作', sortOrder: 4, parentId: catBasic.id },
  });
  const catComp = await prisma.questionCategory.create({
    data: { name: '综合题', sortOrder: 5 },
  });

  console.log('✅ 分类创建完成');

  // Create questions
  const q1 = await prisma.question.create({
    data: {
      categoryId: catField.id,
      title: '创建学生档案表',
      description: '请在金山多维表格中创建一个名为「学生档案」的数据表，并添加以下字段：\n1. 姓名（文本）\n2. 年龄（数字）\n3. 性别（单选：男/女）\n4. 出生日期（日期）',
      type: 'create_table',
      difficulty: 'easy',
      score: 20,
      answerRules: [
        { id: 'r1', action: 'check_table_exists', params: { tableName: '学生档案' }, score: 5 },
        { id: 'r2', action: 'check_field', params: { tableName: '学生档案', fieldName: '姓名', type: 'text' }, score: 5 },
        { id: 'r3', action: 'check_field', params: { tableName: '学生档案', fieldName: '年龄', type: 'number' }, score: 5 },
        { id: 'r4', action: 'check_field', params: { tableName: '学生档案', fieldName: '性别', type: 'single_select', options: ['男', '女'] }, score: 3 },
        { id: 'r5', action: 'check_field', params: { tableName: '学生档案', fieldName: '出生日期', type: 'date' }, score: 2 },
      ],
      hints: '提示：创建表时注意表名不要有错别字',
      tags: ['建表', '字段'],
      status: 'published',
      createdBy: teacher.id,
    },
  });

  const q2 = await prisma.question.create({
    data: {
      categoryId: catView.id,
      title: '创建任务看板视图',
      description: '请在「任务表」中创建一个看板视图，按「状态」字段分组。\n要求：\n1. 视图名称设为「任务看板」\n2. 按「状态」字段分组\n3. 仅显示「优先级=高」的记录',
      type: 'config_view',
      difficulty: 'medium',
      score: 15,
      answerRules: [
        { id: 'r1', action: 'check_view_exists', params: { tableName: '任务表', viewName: '任务看板' }, score: 5 },
        { id: 'r2', action: 'check_view_type', params: { tableName: '任务表', viewName: '任务看板', viewType: 'kanban' }, score: 5 },
        { id: 'r3', action: 'check_view_group', params: { tableName: '任务表', viewName: '任务看板', groupByField: '状态' }, score: 3 },
        { id: 'r4', action: 'check_view_filter', params: { tableName: '任务表', viewName: '任务看板', field: '优先级', value: '高' }, score: 2 },
      ],
      hints: '看板视图中可以设置分组字段和筛选条件',
      tags: ['视图', '看板', '筛选'],
      status: 'published',
      createdBy: teacher.id,
    },
  });

  const q3 = await prisma.question.create({
    data: {
      categoryId: catForm.id,
      title: '创建报名表单',
      description: '请为「报名表」创建一个表单视图，具体要求：\n1. 表单名称：「报名入口」\n2. 隐藏「内部备注」字段\n3. 设置提交提示语为「报名成功！」',
      type: 'comprehensive',
      difficulty: 'medium',
      score: 15,
      answerRules: [
        { id: 'r1', action: 'check_form_exists', params: { tableName: '报名表', formName: '报名入口' }, score: 5 },
        { id: 'r2', action: 'check_form_fields', params: { tableName: '报名表', formName: '报名入口', hiddenFields: ['内部备注'] }, score: 5 },
        { id: 'r3', action: 'check_form_settings', params: { tableName: '报名表', formName: '报名入口', submitMessage: '报名成功！' }, score: 5 },
      ],
      tags: ['表单', '设置'],
      status: 'published',
      createdBy: teacher.id,
    },
  });

  const q4 = await prisma.question.create({
    data: {
      categoryId: catComp.id,
      title: '搭建图书管理系统',
      description: '请构建一个完整的图书管理系统，包含以下内容：\n1. 创建「图书表」（书名、作者、ISBN、状态）\n2. 创建「借阅表」（借阅人、图书、借阅日期、归还日期）\n3. 建立两张表的关联关系\n4. 创建借阅表单\n5. 创建「逾期未还」的筛选视图',
      type: 'comprehensive',
      difficulty: 'hard',
      score: 50,
      answerRules: [
        { id: 'r1', action: 'check_table_exists', params: { tableName: '图书表' }, score: 5 },
        { id: 'r2', action: 'check_field', params: { tableName: '图书表', fieldName: '书名', type: 'text' }, score: 5 },
        { id: 'r3', action: 'check_field', params: { tableName: '图书表', fieldName: '作者', type: 'text' }, score: 5 },
        { id: 'r4', action: 'check_field', params: { tableName: '图书表', fieldName: 'ISBN', type: 'text' }, score: 3 },
        { id: 'r5', action: 'check_table_exists', params: { tableName: '借阅表' }, score: 5 },
        { id: 'r6', action: 'check_field', params: { tableName: '借阅表', fieldName: '借阅人', type: 'text' }, score: 3 },
        { id: 'r7', action: 'check_linked_record', params: { tableName: '借阅表', targetTable: '图书表' }, score: 10 },
        { id: 'r8', action: 'check_form_exists', params: { tableName: '借阅表' }, score: 5 },
        { id: 'r9', action: 'check_view_filter', params: { tableName: '借阅表', viewName: '逾期未还', field: '归还日期' }, score: 9 },
      ],
      hints: '关联记录是多维表格的核心功能，请确保先创建好两张表',
      tags: ['综合', '关联', '系统设计'],
      status: 'published',
      createdBy: teacher.id,
    },
  });

  console.log('✅ 题目创建完成');

  // Create an exam
  const exam = await prisma.exam.create({
    data: {
      title: '多维表格基础操作考核',
      description: '本次考试考察你对金山多维表格基本操作的掌握程度，包括建表、字段配置、视图管理和表单创建。',
      mode: 'exam',
      durationMinutes: 60,
      totalScore: 100,
      passScore: 60,
      status: 'published',
      settings: {
        allowRetake: false,
        shuffleQuestions: true,
      },
      createdBy: teacher.id,
    },
  });

  // Add questions to exam
  await prisma.examQuestion.createMany({
    data: [
      { examId: exam.id, questionId: q1.id, sortOrder: 1 },
      { examId: exam.id, questionId: q2.id, sortOrder: 2 },
      { examId: exam.id, questionId: q3.id, sortOrder: 3 },
      { examId: exam.id, questionId: q4.id, sortOrder: 4 },
    ],
  });

  console.log('✅ 考试创建完成');

  // Create a submission for student1 (already graded)
  const submission = await prisma.studentSubmission.create({
    data: {
      examId: exam.id,
      studentId: student1.id,
      tableSpaceId: 'space_demo_001',
      status: 'graded',
      startedAt: new Date('2024-06-01T09:00:00Z'),
      submittedAt: new Date('2024-06-01T09:45:00Z'),
      gradedAt: new Date('2024-06-01T10:00:00Z'),
      totalScore: 85,
      graderComment: '整体完成不错，视图筛选条件略有不足',
      gradedBy: teacher.id,
      details: {
        create: [
          { questionId: q1.id, score: 20, isCorrect: true },
          { questionId: q2.id, score: 12, isCorrect: true },
          { questionId: q3.id, score: 15, isCorrect: true },
          { questionId: q4.id, score: 38, isCorrect: true },
        ],
      },
    },
  });

  console.log('✅ 答卷示例创建完成');
  console.log('');
  console.log('📋 种子数据完成！');
  console.log('  管理员: admin / 123456');
  console.log('  教师:   teacher1 / 123456');
  console.log('  学生:   student1 / 123456, student2 / 123456');
}

main()
  .catch((e) => {
    console.error('❌ 种子数据填充失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
