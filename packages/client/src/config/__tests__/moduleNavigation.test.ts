/**
 * 导航可见性测试 — 班级管理入口
 *
 * 背景：班级列表取代「院系架构」成为主入口。
 * - 教师端入口：/teacher/classes（仅 teacher，避免 admin 同时看到两个班级入口）
 * - 管理端入口：/admin/classes（系统管理模块）
 * - 旧 /teacher/departments 已从菜单移除，只保留页面隐藏入口
 *
 * 另需锁住向后兼容：role 缺省时必须完全不做角色过滤——
 * 既有调用方（含未传 role 的历史用法）不能因新字段静默丢菜单。
 */
import { describe, it, expect } from 'vitest';
import { filterAccessibleModules } from '../moduleNavigation';

const TEACHER_CLASS_KEY = '/teacher/classes';
const ADMIN_CLASS_KEY = '/admin/classes';
const OLD_DEPT_KEY = '/teacher/departments';
const STUDENTS_KEY = '/teacher/students';

/** 展平所有模块的子项 key，便于整体断言 */
function allSubItemKeys(role?: string): string[] {
  return filterAccessibleModules(() => true, role).flatMap(module =>
    module.subItems.map(subItem => subItem.key)
  );
}

describe('filterAccessibleModules — 班级管理入口', () => {
  it('teacher：学生管理模块含「班级管理」，不再含「院系架构」', () => {
    const filtered = filterAccessibleModules(() => true, 'teacher');
    const studentsModule = filtered.find(module => module.key === 'students');
    expect(studentsModule).toBeDefined();

    const keys = studentsModule!.subItems.map(subItem => subItem.key);
    expect(keys).toContain(TEACHER_CLASS_KEY);
    expect(keys).toContain(STUDENTS_KEY);
    expect(keys).not.toContain(OLD_DEPT_KEY);
  });

  it('admin：系统管理模块含「班级管理」，教师端重复入口不再出现', () => {
    const keys = allSubItemKeys('admin');
    expect(keys).toContain(ADMIN_CLASS_KEY);
    expect(keys).not.toContain(TEACHER_CLASS_KEY);
    expect(keys).not.toContain(OLD_DEPT_KEY);
  });

  it('不传 role：不做角色过滤（向后兼容），教师端班级入口仍可见', () => {
    const keys = allSubItemKeys();
    expect(keys).toContain(TEACHER_CLASS_KEY);
    expect(keys).toContain(ADMIN_CLASS_KEY);
    expect(keys).not.toContain(OLD_DEPT_KEY);
  });
});
