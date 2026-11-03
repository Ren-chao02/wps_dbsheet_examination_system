import { useEffect, useState } from 'react';
import { Alert, Form, Modal, Radio, Select, Typography, message } from 'antd';
import api from '../../../services/api';

const { Text } = Typography;

interface TeacherOption {
  id: string;
  username: string;
  realName: string | null;
}

interface BatchAssignTeachersModalProps {
  open: boolean;
  classIds: string[];
  onCancel: () => void;
  onSuccess: () => void;
}

/**
 * 批量分配教师：默认追加，也可以覆盖所选班级原有的教师。
 */
export function BatchAssignTeachersModal({
  open,
  classIds,
  onCancel,
  onSuccess,
}: BatchAssignTeachersModalProps) {
  const [form] = Form.useForm<{ teacherIds: string[]; mode: 'add' | 'replace' }>();
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ mode: 'add' });
    api
      .get<{ data: TeacherOption[] }>('/classrooms/teacher-options')
      .then((res) => setTeachers(res.data.data || []))
      .catch(() => setTeachers([]));
  }, [open, form]);

  const handleSubmit = async (values: { teacherIds: string[]; mode: 'add' | 'replace' }) => {
    setSaving(true);
    try {
      await api.post('/classrooms/batch-teachers', {
        classIds,
        teacherIds: values.teacherIds,
        mode: values.mode,
      });
      message.success(
        `已${values.mode === 'replace' ? '覆盖' : '追加'}分配：${classIds.length} 个班级 / ${values.teacherIds.length} 位教师`,
      );
      onSuccess();
      onCancel();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || '分配失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="批量分配教师"
      open={open}
      onOk={() => form.submit()}
      onCancel={onCancel}
      okText="确认分配"
      cancelText="取消"
      confirmLoading={saving}
      width={520}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={`已选择 ${classIds.length} 个班级`}
      />
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="teacherIds"
          label="管理教师"
          rules={[{ required: true, message: '请选择至少一位教师' }]}
        >
          <Select
            mode="multiple"
            allowClear
            placeholder="选择要分配的教师"
            options={teachers.map((teacher) => ({
              value: teacher.id,
              label: teacher.realName
                ? `${teacher.realName}（${teacher.username}）`
                : teacher.username,
            }))}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item name="mode" label="分配方式">
          <Radio.Group>
            <Radio value="add">追加（保留原有教师）</Radio>
            <Radio value="replace">覆盖原有教师</Radio>
          </Radio.Group>
        </Form.Item>

        <Text type="secondary" style={{ fontSize: 12 }}>
          覆盖模式会先清空所选班级的现有教师分配，再写入本次选中的教师。
        </Text>
      </Form>
    </Modal>
  );
}
