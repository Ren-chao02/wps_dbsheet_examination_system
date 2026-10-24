import { describe, expect, it } from 'vitest';
import {
  LOGIN_ROLE_STORAGE_KEY,
  getLoginRoleMeta,
  identifierStorageKey,
  normalizeLoginRole,
  readRememberedIdentifier,
  type LoginRole,
} from '../login-roles';

function storageOf(entries: Record<string, string>): Pick<Storage, 'getItem'> {
  return { getItem: (key) => entries[key] ?? null };
}

describe('登录身份文案', () => {
  it('学生使用学号，并保留邀请入班与 WPS 登录', () => {
    const meta = getLoginRoleMeta('student');
    expect(meta.identifierLabel).toBe('学号');
    expect(meta.identifierPlaceholder).toBe('请输入学号');
    expect(meta.subtitle).toContain('学号');
    expect(meta.showInvitation).toBe(true);
    expect(meta.showWpsSso).toBe(true);
  });

  it('教师使用工号，隐藏邀请入班但保留 WPS 登录', () => {
    const meta = getLoginRoleMeta('teacher');
    expect(meta.identifierLabel).toBe('工号');
    expect(meta.identifierPlaceholder).toBe('请输入工号');
    expect(meta.subtitle).toContain('工号');
    expect(meta.showInvitation).toBe(false);
    expect(meta.showWpsSso).toBe(true);
  });

  it('管理员使用系统账号，隐藏邀请入班与 WPS 登录', () => {
    const meta = getLoginRoleMeta('admin');
    expect(meta.identifierLabel).toBe('系统账号');
    expect(meta.identifierPlaceholder).toBe('请输入系统账号');
    expect(meta.subtitle).toContain('系统账号');
    expect(meta.showInvitation).toBe(false);
    expect(meta.showWpsSso).toBe(false);
  });

  it('三个身份的帮助文案各按自己的求助对象写明', () => {
    const student = getLoginRoleMeta('student').help;
    const teacher = getLoginRoleMeta('teacher').help;
    const admin = getLoginRoleMeta('admin').help;

    expect(student.forgotPassword).toContain('任课教师');
    expect(teacher.forgotPassword).toContain('学校管理员');
    expect(admin.forgotPassword).toContain('系统运维');
    expect(new Set([student.forgotPassword, teacher.forgotPassword, admin.forgotPassword]).size).toBe(3);
  });
});

describe('normalizeLoginRole', () => {
  it('原样接受三个合法身份', () => {
    const roles: LoginRole[] = ['student', 'teacher', 'admin'];
    roles.forEach((role) => expect(normalizeLoginRole(role)).toBe(role));
  });

  it('未知值、空值与 null 回退到学生', () => {
    expect(normalizeLoginRole('superuser')).toBe('student');
    expect(normalizeLoginRole('')).toBe('student');
    expect(normalizeLoginRole(null)).toBe('student');
    expect(normalizeLoginRole(undefined)).toBe('student');
  });
});

describe('按身份记住账号', () => {
  it('每个身份使用独立的存储键', () => {
    expect(identifierStorageKey('student')).toBe('login_remembered_identifier_student');
    expect(identifierStorageKey('teacher')).toBe('login_remembered_identifier_teacher');
    expect(identifierStorageKey('admin')).toBe('login_remembered_identifier_admin');
    expect(LOGIN_ROLE_STORAGE_KEY).toBe('login_last_role');
  });

  it('优先读取当前身份自己的账号', () => {
    const storage = storageOf({
      [identifierStorageKey('teacher')]: 'T2026001',
      login_last_identifier: '20260001',
    });
    expect(readRememberedIdentifier('teacher', storage)).toBe('T2026001');
  });

  it('没有当前身份的记录时兼容旧版单一账号', () => {
    const storage = storageOf({ login_last_identifier: '20260001' });
    expect(readRememberedIdentifier('student', storage)).toBe('20260001');
  });

  it('完全没有记录时返回空串', () => {
    expect(readRememberedIdentifier('admin', storageOf({}))).toBe('');
  });
});
