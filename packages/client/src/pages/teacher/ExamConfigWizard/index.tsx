import { useState, useEffect } from 'react';
import { Modal, Steps, message } from 'antd';
import { BatchSelectStep } from './BatchSelectStep';
import { PaperBindStep } from './PaperBindStep';
import { RoomInvigilationStep } from './RoomInvigilationStep';
import { StudentAssignStep } from './StudentAssignStep';
import { WpsTableAssignStep } from './WpsTableAssignStep';

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

export function ExamConfigWizard({ open, onClose, onSuccess }: ExamConfigWizardProps) {
  const [current, setCurrent] = useState(0);
  const [exam, setExam] = useState<WizardExam | null>(null);

  useEffect(() => {
    if (!open) {
      setCurrent(0);
      setExam(null);
    }
  }, [open]);

  const steps = [
    { title: '选择批次', key: 'batch' },
    { title: '绑定试卷', key: 'paper' },
    { title: '考场监考设置', key: 'room' },
    { title: '考生设置', key: 'student' },
    { title: 'WPS 表格分配', key: 'wps-table' },
  ];

  const handleExamCreated = (created: WizardExam) => {
    setExam(created);
    setCurrent(1);
  };

  const handleStepSaved = () => {
    if (current < steps.length - 1) {
      setCurrent(current + 1);
    } else {
      message.success('考试配置完成');
      onSuccess?.();
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
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
