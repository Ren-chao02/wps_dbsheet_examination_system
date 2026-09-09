/**
 * 考试展示辅助 — 供考试列表 / 考试详情抽屉共用，避免各页面重复定义
 */
import dayjs from 'dayjs';
import type { Exam } from '../types';

export interface ExamEditGuardResult {
  disabled: boolean;
  tip?: string;
}

/**
 * 考试编辑权限守卫（纯函数）：
 * - 非创建者一律不可编辑
 * - ended（已结束）不可编辑
 * - in_progress（进行中）不可编辑
 * 其余状态（draft/published/scheduled/cancelled/archived）可编辑（是否拥有所有权由调用方传入）。
 */
export function examEditGuard(status: string, isOwner: boolean): ExamEditGuardResult {
  if (!isOwner) return { disabled: true, tip: '仅支持本人创建的考试' };
  if (status === 'ended') return { disabled: true, tip: '考试已结束，不可编辑' };
  if (status === 'in_progress') return { disabled: true, tip: '考试进行中，不可编辑' };
  return { disabled: false };
}

export const modeLabels: Record<string, string> = { practice: '练习', quiz: '测验', exam: '正式考试' };

export const statusLabels: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿/待发布' },
  published: { color: 'blue', text: '已发布（待考）' },
  scheduled: { color: 'cyan', text: '已排期' },
  in_progress: { color: 'processing', text: '进行中' },
  ended: { color: 'blue', text: '已结束' },
  cancelled: { color: 'red', text: '已取消' },
  archived: { color: 'orange', text: '已归档' },
};

export function formatTimeSlot(exam: Exam): string {
  // 灵活模式：显示批次时间窗口
  if (exam.batch?.examMode === 'flexible' && exam.batch?.startTime) {
    const start = dayjs(exam.batch.startTime);
    const end = exam.batch.endTime ? dayjs(exam.batch.endTime) : null;
    const date = start.format('YYYY-MM-DD');
    if (end && !start.isSame(end, 'day')) {
      return `随到随考 ${start.format('YYYY-MM-DD HH:mm')} ~ ${end.format('YYYY-MM-DD HH:mm')}`;
    }
    return `随到随考 ${date} ${start.format('HH:mm')}${end ? ` ~ ${end.format('HH:mm')}` : ''}`;
  }
  // 集中统一模式或无批次：显示考试自身时间
  if (!exam.startTime) return '未设置';
  const start = dayjs(exam.startTime);
  const end = exam.endTime ? dayjs(exam.endTime) : null;
  if (end && !start.isSame(end, 'day')) {
    return `${start.format('YYYY-MM-DD HH:mm')} ~ ${end.format('YYYY-MM-DD HH:mm')}`;
  }
  const date = start.format('YYYY-MM-DD');
  const startTimeStr = start.format('HH:mm');
  const endTimeStr = end ? end.format('HH:mm') : '';
  return `${date} ${startTimeStr}${endTimeStr ? ` ~ ${endTimeStr}` : ''}`;
}

export function formatRoomSettings(exam: Exam): string {
  if (!exam.assignments || exam.assignments.length === 0) return '未设置';
  return exam.assignments.map(a => a.room.code).join(', ');
}

export function countAssignedStudents(exam: Exam): number {
  return exam.assignments?.reduce((sum, a) => sum + (a._count?.students ?? 0), 0) ?? 0;
}
