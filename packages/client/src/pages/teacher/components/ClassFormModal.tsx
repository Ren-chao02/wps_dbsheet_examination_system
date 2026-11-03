import { useEffect, useMemo, useState } from 'react';
import { Form, Input, Modal, Select, message } from 'antd';
import api from '../../../services/api';
import type { ClassRow, Department, Major } from '../../../types';

interface ClassFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: ClassRow | null;
  onCancel: () => void;
  onSuccess: () => void;
}

interface TeacherOption {
  id: string;
  username: string;
  realName: string | null;
}

function currentAcademicYear(): string {
  const now = new Date();
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${year + 1}`;
}

/**
 * 建班 / 编辑班级。院系/专业是可选的元数据；不填也能建班。
 */
export function ClassFormModal({ open, mode, initial, onCancel, onSuccess }: ClassFormModalProps) {
  const [form] = Form.useForm();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [saving, setSaving] = useState(false);
  const departmentId = Form.useWatch('departmentId', form);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (mode === 'edit' && initial) {
      form.setFieldsValue({
        name: initial.name,
        code: initial.code,
        academicYear: initial.academicYear,
        gradeLevel: initial.gradeLevel,
        departmentId: initial.departmentId || undefined,
        majorId: initial.majorId || undefined,
      });
    } else {
      form.setFieldsValue({ academicYear: currentAcademicYear(), gradeLevel: 1 });
    }

    api
      .get<{ data: Department[] }>('/departments')
      .then((res) => setDepartments(res.data.data || []))
      .catch(() => setDepartments([]));

    if (mode === 'create') {
      api
        .get<{ data: TeacherOption[] }>('/classrooms/teacher-options')
        .then((res) => setTeachers(res.data.data || []))
        .catch(() => setTeachers([]));
    }
  }, [open, mode, initial, form]);

  const majorOptions = useMemo<Major[]>(() => {
    if (!departmentId) return [];
    return departments.find((dept) => dept.id === departmentId)?.majors || [];
  }, [departments, departmentId]);

  const handleDepartmentChange = () => {
    form.setFieldValue('majorId', undefined);
  };

  const handleSubmit = async (values: any) => {
    setSaving(true);
    try {
      const payload = {
        name: values.name.trim(),
        code: values.code?.trim() || undefined,
        academicYear: values.academicYear.trim(),
        gradeLevel: values.gradeLevel,
        departmentId: values.departmentId || null,
        majorId: values.majorId || null,
        ...(mode === 'create' ? { teacherIds: values.teacherIds || [] } : {}),
      };

      if (mode === 'edit' && initial) {
        await api.put(`/classrooms/${initial.id}`, payload);
        message.success('班级已更新');
      } else {
        await api.post('/classrooms', payload);
        message.success('班级已创建');
      }
      onSuccess();
      onCancel();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={mode === 'edit' ? '编辑班级' : '新建班级'}
      open={open}
      onOk={() => form.submit()}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      width={520}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="name"
          label="班级名称"
          rules={[{ required: true, message: '请输入班级名称' }]}
        >
          <Input placeholder="如：2026级计算机1班" maxLength={100} />
        </Form.Item>

        <Form.Item
          name="code"
          label="班级编码"
          extra="学生批量导入时按此编码匹配班级；留空则自动生成"
        >
          <Input placeholder="留空自动生成" maxLength={50} />
        </Form.Item>

        <Form.Item
          name="academicYear"
          label="学年"
          rules={[{ required: true, message: '请输入学年' }]}
        >
          <Input placeholder="如：2026-2027" maxLength={20} />
        </Form.Item>

        <Form.Item name="gradeLevel" label="年级" rules={[{ required: true }]}>
          <Select
            options={[1, 2, 3, 4, 5, 6, 7, 8].map((level) => ({
              value: level,
              label: `${level} 年级`,
            }))}
          />
        </Form.Item>

        <Form.Item name="departmentId" label="院系（可选）">
          <Select
            allowClear
            placeholder="不选则为未分配院系"
            onChange={handleDepartmentChange}
            options={departments.map((dept) => ({ value: dept.id, label: dept.name }))}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item name="majorId" label="专业（可选）">
          <Select
            allowClear
            placeholder={departmentId ? '不选则为未分配专业' : '先选择院系'}
            disabled={!departmentId}
            options={majorOptions.map((major) => ({ value: major.id, label: major.name }))}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        {mode === 'create' && (
          <Form.Item name="teacherIds" label="管理教师（可选）">
            <Select
              mode="multiple"
              allowClear
              placeholder="可稍后在列表中批量分配"
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
        )}
      </Form>
    </Modal>
  );
}
