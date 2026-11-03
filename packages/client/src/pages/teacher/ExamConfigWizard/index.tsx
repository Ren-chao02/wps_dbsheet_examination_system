import { useState, useEffect, useRef } from 'react';
import { Modal, Steps, message } from 'antd';
import { BatchSelectStep } from './BatchSelectStep';
import { PaperBindStep } from './PaperBindStep';
import { RoomInvigilationStep } from './RoomInvigilationStep';
import { StudentAssignStep } from './StudentAssignStep';
import { WpsTableAssignStep } from './WpsTableAssignStep';
import api from '../../../services/api';
import { readDraft, writeDraft, clearDraft, EXAM_CONFIG_WIZARD_DRAFT_KEY } from '../../../utils/wizard-draft';

export interface ExamConfigWizardProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export interface WizardExam {
  id: string;
  title: string;
  batchId?: string;
  paperId?: string | null;
}

/** 落 localStorage 的向导进度：够"回到当时那一步"即可，各步数据本身都在服务端 */
interface WizardDraft {
  examId: string;
  title: string;
  step: number;
}

const steps = [
  { title: '选择批次', key: 'batch' },
  { title: '绑定试卷', key: 'paper' },
  { title: '考场监考设置', key: 'room' },
  { title: '考生设置', key: 'student' },
  { title: 'WPS 表格分配', key: 'wps-table' },
];

/** 询问是否恢复上次未配完的考试。放在模块级，effect 里调用不用进依赖数组 */
async function promptResumeDraft(apply: (exam: WizardExam, step: number) => void) {
  const draft = readDraft<WizardDraft>(EXAM_CONFIG_WIZARD_DRAFT_KEY);
  if (!draft) return;
  if (!draft.examId || !Number.isFinite(draft.step)) {
    // 形状不对（旧版本 / 被改坏）：作废，免得反复弹半截询问
    clearDraft(EXAM_CONFIG_WIZARD_DRAFT_KEY);
    return;
  }
  try {
    const res = await api.get(`/exams/${draft.examId}`);
    const target = res.data;
    // 已发布 / 已结束：这场不该再续配（考试不存在直接落到 catch）
    if (!target || target.status !== 'draft') {
      clearDraft(EXAM_CONFIG_WIZARD_DRAFT_KEY);
      return;
    }
    Modal.confirm({
      title: '发现未完成的考试配置',
      content: `考试《${target.title}》已创建，但配置尚未完成（上次进行到第 ${draft.step + 1} 步）。是否继续配置？点「暂不处理」不会删除考试，它会以草稿形式保留在考试列表里。`,
      okText: '继续配置',
      cancelText: '暂不处理',
      onOk: () => {
        apply(
          { id: target.id, title: target.title, batchId: target.batchId, paperId: target.paperId },
          Math.min(Math.max(draft.step, 0), steps.length - 1),
        );
      },
    });
  } catch {
    // 考试已被删除：草稿作废
    clearDraft(EXAM_CONFIG_WIZARD_DRAFT_KEY);
  }
}

export function ExamConfigWizard({ open, onClose, onSuccess }: ExamConfigWizardProps) {
  const [current, setCurrent] = useState(0);
  const [exam, setExam] = useState<WizardExam | null>(null);
  const completedRef = useRef(false); // 追踪向导是否正常完成
  const resumeCheckedRef = useRef(false); // 每次打开只检查一次草稿，避免重复弹询问

  useEffect(() => {
    if (open) {
      completedRef.current = false; // 弹窗打开时重置完成标记
      if (!resumeCheckedRef.current) {
        resumeCheckedRef.current = true;
        // 页面可能在向导中途被整页重载（dev 下 Vite 因代码改动自动重载、手动刷新等）。
        // 考试在第 1 步就已落库，凭草稿直接回到当时的步骤接着配。
        void promptResumeDraft((resumed, step) => {
          setExam(resumed);
          setCurrent(step);
        });
      }
    } else {
      resumeCheckedRef.current = false;
      setCurrent(0);
      setExam(null);
    }
  }, [open]);

  // 进度落草稿：考试一旦创建，之后每次换步都刷新一次（24 小时过期，口径同 ExamWizard 草稿）
  useEffect(() => {
    if (!exam) return;
    writeDraft<WizardDraft>(EXAM_CONFIG_WIZARD_DRAFT_KEY, {
      examId: exam.id,
      title: exam.title,
      step: current,
    });
  }, [exam, current]);

  // 配置到一半时拦一下整页离开：beforeunload 会让浏览器弹原生确认。
  // dev 环境里 Vite 触发的整页重载同样会被拦住——老师在 WPS 那边复制链接时页面若被重载，
  // 回来点「留在此页」，第 5 步已粘贴的链接就不会被冲掉。
  useEffect(() => {
    if (!open || !exam || completedRef.current) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [open, exam]);

  // 注意：这里刻意「不删考试」。旧实现是弹窗一关就静默 DELETE 掉刚创建的考试
  // （配置到一半误点遮罩就全没了），而整页刷新又根本不触发清理、留下孤儿草稿——
  // 两种行为不一致且都可能伤人。现在关闭和刷新同待遇：保留考试与草稿，
  // 下次打开弹窗可续配，不想要了在考试列表里正常删除。

  const handleExamCreated = (created: WizardExam) => {
    setExam(created);
    setCurrent(1);
  };

  const handleStepSaved = () => {
    if (current < steps.length - 1) {
      setCurrent(current + 1);
    } else {
      completedRef.current = true; // 标记正常完成：草稿作废、不再拦截离开
      clearDraft(EXAM_CONFIG_WIZARD_DRAFT_KEY);
      message.success('考试配置完成');
      onSuccess?.();
      onClose();
    }
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      width={1000}
      footer={null}
      destroyOnHidden
      title={exam ? `[考试名称：${exam.title}] 设置向导` : '新增考试'}
    >
      <Steps current={current} items={steps} style={{ marginBottom: 24 }} />
      {current === 0 && <BatchSelectStep onCreated={handleExamCreated} />}
      {current === 1 && exam && <PaperBindStep exam={exam} onSaved={handleStepSaved} onBack={() => setCurrent(0)} />}
      {current === 2 && exam && <RoomInvigilationStep exam={exam} onSaved={handleStepSaved} onBack={() => setCurrent(1)} />}
      {current === 3 && exam && <StudentAssignStep exam={exam} onSaved={handleStepSaved} onBack={() => setCurrent(2)} />}
      {current === 4 && exam && <WpsTableAssignStep exam={exam} onSaved={handleStepSaved} onBack={() => setCurrent(3)} />}
    </Modal>
  );
}
