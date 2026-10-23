import { test, expect } from '@playwright/test';
import { readCredentials, login } from './helpers/auth';

/**
 * 冒烟：确认这套系统「还起得来」。
 *
 * 不需要任何测试账号就该全绿 —— 这一条是给 CI / 每次改完自查用的最低门槛。
 */
test.describe('冒烟 · 无需账号', () => {
  test('未登录访问首页会被带到登录页，且登录表单完整', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

    // 三个输入框缺一不可：学号/用户名、密码、验证码。
    // 少任何一个都意味着登录链路断了 —— 这是最该在 CI 里守住的东西。
    await expect(page.getByPlaceholder('学号 / 用户名')).toBeVisible();
    await expect(page.getByPlaceholder('密码')).toBeVisible();
    await expect(page.getByPlaceholder('验证码')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    // 学校品牌区是这次改版的标志
    await expect(page.getByText('陕西师范大学').first()).toBeVisible();
  });

  test('验证码图片能取回来（后端可达）', async ({ page }) => {
    const respPromise = page.waitForResponse((r) => r.url().includes('/api/auth/captcha'));
    await page.goto('/login');
    const resp = await respPromise;

    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.captchaToken, '验证码接口应返回 token').toBeTruthy();
    expect(body.svg, '验证码接口应返回图片').toContain('<svg');
  });
});

/**
 * 需要测试账号的用例。
 * 没配 E2E_STUDENT_USERNAME / E2E_STUDENT_PASSWORD 时**跳过而不是失败** ——
 * 否则没配账号的人跑 CI 只会看到一片红，然后学会忽略它。
 */
const studentCreds = readCredentials('STUDENT');

test.describe('冒烟 · 需要账号', () => {
  test.skip(!studentCreds, '未配置 E2E_STUDENT_USERNAME / E2E_STUDENT_PASSWORD');

  test('学生登录后进入学生端首页', async ({ page }) => {
    await login(page, studentCreds!, '/student');
    // 左侧导航是学生端布局的标志
    await expect(page.locator('body')).toContainText(/我的考试|练习|成绩/);
  });
});

const teacherCreds = readCredentials('TEACHER');

test.describe('冒烟 · 教师端', () => {
  test.skip(!teacherCreds, '未配置 E2E_TEACHER_USERNAME / E2E_TEACHER_PASSWORD');

  test('教师登录后进入教师工作台', async ({ page }) => {
    await login(page, teacherCreds!, '/teacher');
    await expect(page.locator('body')).toContainText(/题库|试卷|考试|监考/);
  });
});
