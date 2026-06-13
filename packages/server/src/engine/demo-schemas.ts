/**
 * Demo Mock Schema 数据
 *
 * 模拟 WPS API /schema/query 响应，格式与 KingsoftAdapter.SchemaResponse 完全一致。
 * 用于 Demo 阶段的规则引擎验证，无需真实 WPS API 凭证。
 */

import type { SchemaResponse } from './rule-engine';

// ============================================================
// Q1: "创建学生档案表" — 完整正确答案
// ============================================================

export const DEMO_SCHEMA_Q1: SchemaResponse = {
  result: 0,
  detail: {
    sheets: [
      {
        id: 1,
        name: '学生档案',
        primaryFieldId: 'fld_name',
        fields: [
          { id: 'fld_name', name: '姓名', type: 'SingleLineText', required: true },
          { id: 'fld_age', name: '年龄', type: 'Number', required: false },
          { id: 'fld_gender', name: '性别', type: 'SingleSelect', required: false,
            items: [{ value: '男', color: 4283466178 }, { value: '女', color: 4281378020 }],
          },
          { id: 'fld_birth', name: '出生日期', type: 'Date', required: false },
        ],
        views: [
          { id: 'viw_grid', name: '表格视图', type: 'Grid' },
        ],
      },
    ],
  },
};

// ============================================================
// Q1 部分完成 — 只创建了表名和"姓名"字段，缺少年龄/性别/出生日期/视图
// ============================================================

export const DEMO_SCHEMA_Q1_PARTIAL: SchemaResponse = {
  result: 0,
  detail: {
    sheets: [
      {
        id: 1,
        name: '学生档案',
        primaryFieldId: 'fld_name',
        fields: [
          { id: 'fld_name', name: '姓名', type: 'SingleLineText', required: true },
          // 缺少：年龄(Number)、性别(SingleSelect)、出生日期(Date)
        ],
        views: [],
        // 缺少：表格视图
      },
    ],
  },
};

// ============================================================
// Q2: "创建任务看板视图" — 完整正确答案
// ============================================================

export const DEMO_SCHEMA_Q2: SchemaResponse = {
  result: 0,
  detail: {
    sheets: [
      {
        id: 2,
        name: '任务表',
        primaryFieldId: 'fld_task_name',
        fields: [
          { id: 'fld_task_name', name: '任务名称', type: 'SingleLineText', required: true },
          { id: 'fld_status', name: '状态', type: 'SingleSelect', required: false,
            items: [
              { value: '待办', color: 4283466178 },
              { value: '进行中', color: 4281378020 },
              { value: '已完成', color: 4278237531 },
            ],
          },
          { id: 'fld_priority', name: '优先级', type: 'SingleSelect', required: false,
            items: [
              { value: '高', color: 4294901760 },
              { value: '中', color: 4283466178 },
              { value: '低', color: 4278237531 },
            ],
          },
          { id: 'fld_deadline', name: '截止日期', type: 'Date', required: false },
        ],
        views: [
          { id: 'viw_grid', name: '表格视图', type: 'Grid' },
          { id: 'viw_kanban', name: '任务看板', type: 'Kanban' },
        ],
      },
    ],
  },
};

// ============================================================
// Q3: "创建报名表单" — 完整正确答案
// ============================================================

export const DEMO_SCHEMA_Q3: SchemaResponse = {
  result: 0,
  detail: {
    sheets: [
      {
        id: 3,
        name: '报名表',
        primaryFieldId: 'fld_reg_name',
        fields: [
          { id: 'fld_reg_name', name: '姓名', type: 'SingleLineText', required: true },
          { id: 'fld_reg_phone', name: '联系电话', type: 'Phone', required: true },
          { id: 'fld_reg_email', name: '邮箱', type: 'Email', required: false },
          { id: 'fld_reg_note', name: '内部备注', type: 'MultiLineText', required: false },
          { id: 'fld_reg_course', name: '报名课程', type: 'SingleSelect', required: true,
            items: [
              { value: '基础班' },
              { value: '进阶班' },
              { value: '高级班' },
            ],
          },
        ],
        views: [
          { id: 'viw_grid', name: '表格视图', type: 'Grid' },
          { id: 'viw_form', name: '报名入口', type: 'Form' },
        ],
      },
    ],
  },
};

// ============================================================
// Q4: "搭建图书管理系统" — 完整正确答案
// ============================================================

export const DEMO_SCHEMA_Q4: SchemaResponse = {
  result: 0,
  detail: {
    sheets: [
      {
        id: 10,
        name: '图书表',
        primaryFieldId: 'fld_book_name',
        fields: [
          { id: 'fld_book_name', name: '书名', type: 'SingleLineText', required: true },
          { id: 'fld_author', name: '作者', type: 'SingleLineText', required: true },
          { id: 'fld_isbn', name: 'ISBN', type: 'SingleLineText', required: false },
          { id: 'fld_book_status', name: '状态', type: 'SingleSelect', required: false,
            items: [
              { value: '在馆' },
              { value: '借出' },
              { value: '遗失' },
            ],
          },
        ],
        views: [
          { id: 'viw_book_grid', name: '表格视图', type: 'Grid' },
        ],
      },
      {
        id: 11,
        name: '借阅表',
        primaryFieldId: 'fld_borrower',
        fields: [
          { id: 'fld_borrower', name: '借阅人', type: 'SingleLineText', required: true },
          { id: 'fld_borrow_book', name: '图书', type: 'Link', required: true, linkSheet: '图书表' },
          { id: 'fld_borrow_date', name: '借阅日期', type: 'Date', required: true },
          { id: 'fld_return_date', name: '归还日期', type: 'Date', required: false },
        ],
        views: [
          { id: 'viw_borrow_grid', name: '表格视图', type: 'Grid' },
          { id: 'viw_borrow_form', name: '借阅表单', type: 'Form' },
          { id: 'viw_overdue', name: '逾期未还', type: 'Grid' },
        ],
      },
    ],
  },
};

// ============================================================
// 题目 ID → Mock Schema 索引
// ============================================================

/** 按 demo questionId 索引的 Mock Schema */
export const MOCK_SCHEMAS: Record<string, SchemaResponse> = {
  demo_q1: DEMO_SCHEMA_Q1,
  demo_q1_partial: DEMO_SCHEMA_Q1_PARTIAL,
  demo_q2: DEMO_SCHEMA_Q2,
  demo_q3: DEMO_SCHEMA_Q3,
  demo_q4: DEMO_SCHEMA_Q4,
};
