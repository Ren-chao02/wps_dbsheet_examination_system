/**
 * 导航可见性测试 — 角色限定项（院系架构仅校级管理员）
 *
 * 背景：「院系架构」是全系统唯一能建「院系/专业/班级」的界面，对管理员不可替代；
 * P1 数据范围收口后，教师看到的院系树只剩自己任教的班级且整页只读，该页对教师已无价值，
 * 因此改为「只藏入口 + 页面直链守卫（DepartmentManagement）」。这里锁住菜单层行为，
 * 防止后续配置调整把入口重新暴露给教师。
 *
 * 另需锁住向后兼容：role 缺省时必须完全不做角色过滤——
 * 既有调用方（含未传 role 的历史用法）不能因新字段静默丢菜单。
 */
import { describe, it, expect } from 'vitest';
import { filterAccessibleModules } from '../moduleNavigation';

const DEPT_KEY = '/teacher/departments';
const STUDENTS_KEY = '/teacher/students';

/** 展平所有模块的子项 key，便于整体断言 */
function allSubItemKeys(role?: string): string[] {
  return filterAccessibleModules(() => true, role).flatMap(module =>
    module.subItems.map(subItem => subItem.key)
  );
}

describe('filterAccessibleModules — 角色限定（院系架构仅校级管理员）', () => {
  it('teacher：学生管理模块子项不含「院系架构」，但仍保留「学生列表」', () => {
    const filtered = filterAccessibleModules(() => true, 'teacher');
    const studentsModule = filtered.find(module => module.key === 'students');
    expect(studentsModule).toBeDefined();

    const keys = studentsModule!.subItems.map(subItem => subItem.key);
    expect(keys).not.toContain(DEPT_KEY);
    expect(keys).toContain(STUDENTS_KEY);
  });

  it('admin：仍含「院系架构」', () => {
    expect(allSubItemKeys('admin')).toContain(DEPT_KEY);
  });

  it('不传 role：不做角色过滤（向后兼容），仍含「院系架构」', () => {
    expect(allSubItemKeys()).toContain(DEPT_KEY);
  });
});
