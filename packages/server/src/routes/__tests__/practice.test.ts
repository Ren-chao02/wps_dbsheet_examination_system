import { describe, it, expect } from 'vitest';
import {
  practiceSubmitSchema,
  favoriteSchema,
  feedbackSchema,
  assignmentSchema,
  startSchema,
} from '../practice';

describe('Practice validation schemas', () => {
  it('practiceSubmitSchema rejects empty body', () => {
    const result = practiceSubmitSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('practiceSubmitSchema accepts valid payload', () => {
    const result = practiceSubmitSchema.safeParse({
      paperId: '00000000-0000-0000-0000-000000000001',
      answers: [
        { questionId: '00000000-0000-0000-0000-000000000002', answerJson: { text: 'answer' } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('favoriteSchema requires UUID questionId', () => {
    expect(favoriteSchema.safeParse({ questionId: 'not-a-uuid' }).success).toBe(false);
    expect(favoriteSchema.safeParse({ questionId: '00000000-0000-0000-0000-000000000001' }).success).toBe(true);
  });

  it('feedbackSchema only allows known feedback types', () => {
    expect(
      feedbackSchema.safeParse({
        questionId: '00000000-0000-0000-0000-000000000001',
        feedbackType: 'invalid',
        content: 'test',
      }).success
    ).toBe(false);

    expect(
      feedbackSchema.safeParse({
        questionId: '00000000-0000-0000-0000-000000000001',
        feedbackType: 'question',
        content: 'test',
      }).success
    ).toBe(true);
  });
});

describe('assignmentSchema', () => {
  it('rejects empty body (missing fileId)', () => {
    expect(assignmentSchema.safeParse({}).success).toBe(false);
  });

  it('rejects empty-string fileId', () => {
    expect(assignmentSchema.safeParse({ fileId: '' }).success).toBe(false);
  });

  it('accepts minimal payload with only fileId', () => {
    const result = assignmentSchema.safeParse({ fileId: 'file-abc-123' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fileId).toBe('file-abc-123');
      expect(result.data.shareUrl).toBeUndefined();
      expect(result.data.accessToken).toBeUndefined();
    }
  });

  it('accepts full payload with shareUrl and accessToken', () => {
    const result = assignmentSchema.safeParse({
      fileId: 'file-abc-123',
      shareUrl: 'https://www.kdocs.cn/l/abc',
      accessToken: 'tok-xyz',
    });
    expect(result.success).toBe(true);
  });
});

describe('startSchema', () => {
  it('accepts empty body and defaults count to 5', () => {
    const result = startSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.count).toBe(5);
    }
  });

  it('rejects invalid difficulty', () => {
    expect(startSchema.safeParse({ difficulty: 'impossible' }).success).toBe(false);
  });

  it('rejects non-UUID primaryCategoryId', () => {
    expect(startSchema.safeParse({ primaryCategoryId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects count out of range', () => {
    expect(startSchema.safeParse({ count: 0 }).success).toBe(false);
    expect(startSchema.safeParse({ count: 21 }).success).toBe(false);
  });

  it('accepts a full valid payload', () => {
    const result = startSchema.safeParse({
      primaryCategoryId: '00000000-0000-0000-0000-000000000001',
      secondaryCategoryId: '00000000-0000-0000-0000-000000000002',
      difficulty: 'hard',
      count: 10,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.difficulty).toBe('hard');
      expect(result.data.count).toBe(10);
    }
  });

  it('accepts questionIds for 个人题集再练', () => {
    const result = startSchema.safeParse({
      questionIds: [
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.questionIds).toHaveLength(2);
    }
  });

  it('rejects questionIds beyond 1..20 range', () => {
    expect(startSchema.safeParse({ questionIds: [] }).success).toBe(false);
    const tooMany = Array.from({ length: 21 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    expect(startSchema.safeParse({ questionIds: tooMany }).success).toBe(false);
  });

  it('rejects questionIds mixing with category/difficulty filters', () => {
    expect(
      startSchema.safeParse({
        questionIds: ['00000000-0000-0000-0000-000000000001'],
        difficulty: 'easy',
      }).success
    ).toBe(false);
    expect(
      startSchema.safeParse({
        questionIds: ['00000000-0000-0000-0000-000000000001'],
        primaryCategoryId: '00000000-0000-0000-0000-000000000002',
      }).success
    ).toBe(false);
  });
});

// ============================================================
// 端点集成测试骨架（需要 DB + WPS mock，暂留 todo）
// 这些用例描述了 /practice/start 与 /:recordId/submit 的预期行为，
// 待引入 supertest + prisma mock 基础设施后补全。
// ============================================================
describe('POST /api/practice/start (integration skeleton)', () => {
  it.todo('未注册练习文件时返回 400');

  it.todo('accessToken 缺失时返回 400（无法重置文件）');

  it.todo('筛选条件下无题目时返回 400');

  it.todo('resetFile 抛错时不创建 PracticeRecord（原子性）');

  it.todo('成功时返回 recordId / questions / maxScore / shareUrl，且 record.status=in_progress');
});

describe('POST /api/practice/:recordId/submit (integration skeleton)', () => {
  it.todo('记录不存在时返回 404');

  it.todo('他人记录返回 403');

  it.todo('判分成功返回 score/maxScore/passed/details');

  it.todo('判分失败时 record.status 保持 in_progress（可重试）');
});
