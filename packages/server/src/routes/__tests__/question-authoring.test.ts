/**
 * 出题辅助路由集成测试
 *
 * 覆盖：
 * - POST /api/questions/skeleton
 * - POST /api/questions/reverse-rules
 *
 * 通过 vi.mock 替换 authenticate（免 JWT/DB）与 KingsoftAdapter（免真实 WPS 调用），
 * 用 supertest 驱动 Express 路由，验证鉴权、参数校验、401 透传、正常返回。
 *
 * @see docs/superpowers/specs/2026-07-07-exam-authoring-assist.md §5.4
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { SchemaResponse } from '../../engine/rule-engine';

// ------------------------------------------------------------
// Mock authenticate / authorize — 免 JWT、免 DB
// ------------------------------------------------------------

/** 控制 mock 用户的角色；测试用例可覆盖 */
let mockRole: string = 'teacher';

vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: '未提供认证令牌' });
    }
    req.user = {
      id: 'u-teacher-1',
      userId: 'u-teacher-1',
      username: 'teacher1',
      role: mockRole,
    };
    next();
  },
  authorize: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ message: '未认证' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: '权限不足' });
    }
    next();
  },
}));

// ------------------------------------------------------------
// Mock KingsoftAdapter — 免真实 WPS 调用
// ------------------------------------------------------------

let mockSchema: SchemaResponse;
let mockGetSchemaError: Error | null = null;
/** 记录最近一次 KingsoftAdapter 实例化参数（用于断言缓存的 accessToken 被传入） */
let lastAdapterArgs: { fileId: string; accessToken: string; apiSecret?: string } | null = null;

vi.mock('../../engine/adapters/kingsoft-adapter', () => ({
  KingsoftAdapter: class MockKingsoftAdapter {
    constructor(fileId: string, accessToken: string, apiSecret?: string) {
      lastAdapterArgs = { fileId, accessToken, apiSecret };
    }
    async getSchema(): Promise<SchemaResponse> {
      if (mockGetSchemaError) throw mockGetSchemaError;
      return mockSchema;
    }
  },
}));

// Mock WPS 配置服务 — accessToken 缺省时自动读取服务端缓存的路径
const { wpsConfigGetMock } = vi.hoisted(() => ({ wpsConfigGetMock: vi.fn() }));
vi.mock('../../services/wps-config-service', () => ({
  wpsConfigService: { get: (...args: unknown[]) => wpsConfigGetMock(...args) },
}));

// mock 生效后导入路由
import { questionRouter } from '../questions';

// ------------------------------------------------------------
// 测试 fixture
// ------------------------------------------------------------

function makeSchema(): SchemaResponse {
  return {
    result: 0,
    detail: {
      sheets: [
        {
          id: 1,
          name: '考勤表',
          primaryFieldId: 'f1',
          fields: [
            { id: 'f1', name: '姓名', type: 'SingleLineText' },
            {
              id: 'f2',
              name: '考勤状态',
              type: 'SingleSelect',
              items: [
                { value: '出勤', color: 1 },
                { value: '请假', color: 2 },
              ],
            },
          ],
          views: [{ id: 'v1', name: '表格视图', type: 'Grid' }],
        },
      ],
    },
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/questions', questionRouter);
  return app;
}

const TEACHER_TOKEN = 'Bearer mock-teacher-token';
const STUDENT_TOKEN = 'Bearer mock-student-token';

// ------------------------------------------------------------
// 测试
// ------------------------------------------------------------

describe('POST /api/questions/skeleton', () => {
  beforeEach(() => {
    mockRole = 'teacher';
  });

  it('未认证返回 401', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/questions/skeleton')
      .send({ capabilityIds: ['table.create'] });
    expect(res.status).toBe(401);
  });

  it('学生角色返回 403', async () => {
    mockRole = 'student';
    const app = makeApp();
    const res = await request(app)
      .post('/api/questions/skeleton')
      .set('Authorization', STUDENT_TOKEN)
      .send({ capabilityIds: ['table.create'] });
    expect(res.status).toBe(403);
  });

  it('空 capabilityIds 返回 400', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/questions/skeleton')
      .set('Authorization', TEACHER_TOKEN)
      .send({ capabilityIds: [] });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('参数错误');
  });

  it('有效请求返回题目骨架', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/questions/skeleton')
      .set('Authorization', TEACHER_TOKEN)
      .send({ capabilityIds: ['table.create', 'field.text'] });
    expect(res.status).toBe(200);
    expect(res.body.title).toBeTruthy();
    expect(res.body.ruleTemplates).toBeInstanceOf(Array);
    expect(res.body.ruleTemplates.length).toBeGreaterThan(0);
    expect(res.body.selectedCapabilities).toBeInstanceOf(Array);
    expect(res.body.suggestedScore).toBeGreaterThan(0);
  });

  it('未知能力 id 记入 warnings', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/questions/skeleton')
      .set('Authorization', TEACHER_TOKEN)
      .send({ capabilityIds: ['table.create', 'fake.capability'] });
    expect(res.status).toBe(200);
    expect(res.body.warnings.some((w: string) => w.includes('fake.capability'))).toBe(true);
  });
});

describe('POST /api/questions/reverse-rules', () => {
  beforeEach(() => {
    mockRole = 'teacher';
    mockSchema = makeSchema();
    mockGetSchemaError = null;
    lastAdapterArgs = null;
    wpsConfigGetMock.mockReset();
    wpsConfigGetMock.mockResolvedValue(null); // 默认：服务端无缓存 token
  });

  it('未认证返回 401', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/questions/reverse-rules')
      .send({
        capabilities: ['field.single_select'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });
    expect(res.status).toBe(401);
  });

  it('学生角色返回 403', async () => {
    mockRole = 'student';
    const app = makeApp();
    const res = await request(app)
      .post('/api/questions/reverse-rules')
      .set('Authorization', STUDENT_TOKEN)
      .send({
        capabilities: ['field.single_select'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });
    expect(res.status).toBe(403);
  });

  it('缺 accessToken 且服务端无缓存 WPS Token 时返回 400', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/questions/reverse-rules')
      .set('Authorization', TEACHER_TOKEN)
      .send({
        capabilities: ['field.single_select'],
        fileId: 'file-1',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('accessToken');
    expect(wpsConfigGetMock).toHaveBeenCalledTimes(1);
  });

  it('缺 accessToken 时自动使用服务端缓存 token 生成规则', async () => {
    wpsConfigGetMock.mockResolvedValue({ accessToken: 'cached-token', clientId: 'c1' });
    const app = makeApp();
    const res = await request(app)
      .post('/api/questions/reverse-rules')
      .set('Authorization', TEACHER_TOKEN)
      .send({
        capabilities: ['field.single_select'],
        fileId: 'file-1',
      });
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toBeInstanceOf(Array);
    // 路由应把缓存 token 传给 KingsoftAdapter，而不是报缺参
    expect(lastAdapterArgs?.accessToken).toBe('cached-token');
  });

  it('空 capabilities 返回 400', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/questions/reverse-rules')
      .set('Authorization', TEACHER_TOKEN)
      .send({
        capabilities: [],
        fileId: 'file-1',
        accessToken: 'token-1',
      });
    expect(res.status).toBe(400);
  });

  it('有效请求返回规则建议与 schemaSummary', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/questions/reverse-rules')
      .set('Authorization', TEACHER_TOKEN)
      .send({
        capabilities: ['field.single_select'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toBeInstanceOf(Array);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    expect(res.body.schemaSummary).toBeDefined();
    expect(res.body.schemaSummary.sheets).toBeInstanceOf(Array);
    // 参数 100% 来自 Schema
    const checkFieldRule = res.body.suggestions.find(
      (s: any) => s.rule.action === 'check_field',
    );
    expect(checkFieldRule.rule.params.tableName).toBe('考勤表');
    expect(checkFieldRule.rule.params.fieldName).toBe('考勤状态');
    expect(checkFieldRule.rule.params.type).toBe('single_select');
  });

  it('WPS accessToken 过期返回 400（避免前端全局 401 登录跳转）', async () => {
    mockGetSchemaError = Object.assign(new Error('API 请求失败 [/schema/query]: 401 Unauthorized'), {
      status: 401,
    });
    const app = makeApp();
    const res = await request(app)
      .post('/api/questions/reverse-rules')
      .set('Authorization', TEACHER_TOKEN)
      .send({
        capabilities: ['field.single_select'],
        fileId: 'file-1',
        accessToken: 'expired-token',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('令牌');
  });

  it('未知能力 id 记入 notes 且不影响其他建议', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/questions/reverse-rules')
      .set('Authorization', TEACHER_TOKEN)
      .send({
        capabilities: ['field.single_select', 'fake.capability'],
        fileId: 'file-1',
        accessToken: 'token-1',
      });
    expect(res.status).toBe(200);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    expect(res.body.notes.some((n: string) => n.includes('fake.capability'))).toBe(true);
  });
});
