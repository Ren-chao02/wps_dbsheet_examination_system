import { useEffect, useState } from 'react';
import { Form, Select, Button, DatePicker, Tag, Descriptions, message, Alert, Input } from 'antd';
import dayjs from 'dayjs';
import api from '../../../services/api';
import type { WizardExam } from './index';

interface BatchSelectStepProps {
  onCreated: (exam: WizardExam) => void;
}

const modeLabels: Record<string, string> = {
  unified: '集中统一',
  flexible: '随到随考',
};

export function BatchSelectStep({ onCreated }: BatchSelectStepProps) {
  const [form] = Form.useForm();
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const startTime = Form.useWatch('startTime', form);

  useEffect(() => {
    api.get('/batches?pageSize=100')
      .then(res => setBatches((res.data?.data || []).filter((b: any) => b.status !== 'archived')))
      .catch(() => message.error('加载批次失败'));
  }, []);

  // 集中统一模式下，开始时间变化后自动根据考试时长计算结束时间
  useEffect(() => {
    if (selectedBatch?.examMode === 'unified' && startTime) {
      const endTime = startTime.clone().add(selectedBatch.examDuration, 'minute');
      form.setFieldsValue({ endTime });
    }
  }, [startTime, selectedBatch, form]);

  const handleBatchChange = (batchId: string) => {
    const batch = batches.find(b => b.id === batchId);
    setSelectedBatch(batch || null);
    // 重置时间字段
    form.setFieldsValue({ startTime: undefined, endTime: undefined });
  };

  const handleNext = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const payload: any = {
        title: values.title,
        mode: 'exam',
        durationMinutes: selectedBatch?.examDuration ?? 60,
        batchId: values.batchId,
      };

      if (selectedBatch?.examMode === 'unified') {
        payload.startTime = values.startTime.toISOString();
        payload.endTime = values.endTime.toISOString();
      }

      const res = await api.post('/exams', payload);

      onCreated({
        id: res.data.id,
        title: res.data.title,
        batchId: res.data.batchId,
        paperId: res.data.paperId,
      });
    } catch (err: any) {
      if (err.response?.data?.message) {
        message.error(err.response.data.message);
      } else if (err.errorFields?.length) {
        // 表单校验错误，不显示额外提示
      } else {
        message.error('创建考试失败');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form form={form} layout="vertical">
      <Form.Item
        name="title"
        label="考试名称"
        rules={[{ required: true, message: '请输入考试名称' }]}
      >
        <Input placeholder="如：WPS多维表格基础操作考核" />
      </Form.Item>

      <Form.Item
        name="batchId"
        label="选择批次"
        rules={[{ required: true, message: '请先选择批次' }]}
      >
        <Select
          placeholder="请选择考试批次"
          showSearch
          optionFilterProp="children"
          onChange={handleBatchChange}
        >
          {batches.map(b => (
            <Select.Option key={b.id} value={b.id}>{b.name}</Select.Option>
          ))}
        </Select>
      </Form.Item>

      {selectedBatch && (
        <>
          <Descriptions
            bordered
            size="small"
            column={2}
            style={{ marginBottom: 16 }}
            title="批次信息"
          >
            <Descriptions.Item label="批次名称">{selectedBatch.name}</Descriptions.Item>
            <Descriptions.Item label="考试模式">
              <Tag color={selectedBatch.examMode === 'unified' ? 'blue' : 'green'}>
                {modeLabels[selectedBatch.examMode] || selectedBatch.examMode}
              </Tag>
            </Descriptions.Item>
            {selectedBatch.startTime && (
              <Descriptions.Item label="批次开始时间">
                {dayjs(selectedBatch.startTime).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
            )}
            {selectedBatch.endTime && (
              <Descriptions.Item label="批次结束时间">
                {dayjs(selectedBatch.endTime).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="考试时长">{selectedBatch.examDuration} 分钟</Descriptions.Item>
            <Descriptions.Item label="候考时间">{selectedBatch.waitingTime} 分钟</Descriptions.Item>
          </Descriptions>

          {selectedBatch.examMode === 'unified' && (
            <>
              <Alert
                type="info"
                showIcon
                message="集中统一模式"
                description={`请在本场考试时间范围内设置开始时间，结束时间将自动按考试时长 ${selectedBatch.examDuration} 分钟计算`}
                style={{ marginBottom: 16 }}
              />
              <Form.Item
                name="startTime"
                label="本场考试开始时间"
                rules={[
                  { required: true, message: '请选择考试开始时间' },
                  {
                    validator: (_, value) => {
                      if (!value || !selectedBatch.startTime || !selectedBatch.endTime) return Promise.resolve();
                      if (value.isBefore(dayjs(selectedBatch.startTime))) {
                        return Promise.reject(new Error('考试开始时间不能早于批次开始时间'));
                      }
                      const calculatedEnd = value.clone().add(selectedBatch.examDuration, 'minute');
                      if (calculatedEnd.isAfter(dayjs(selectedBatch.endTime))) {
                        return Promise.reject(new Error('考试结束时间不能晚于批次结束时间，请提前开始时间'));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <DatePicker
                  showTime
                  style={{ width: '100%' }}
                  disabledDate={(current) => {
                    if (!current) return false;
                    if (selectedBatch.startTime) return current.isBefore(dayjs(selectedBatch.startTime), 'day');
                    return false;
                  }}
                />
              </Form.Item>
              <Form.Item
                name="endTime"
                label="本场考试结束时间"
                rules={[{ required: true, message: '请选择考试结束时间' }]}
                extra="结束时间由系统根据开始时间和考试时长自动计算"
              >
                <DatePicker
                  showTime
                  style={{ width: '100%' }}
                  disabled={selectedBatch.examMode === 'unified'}
                  disabledDate={(current) => {
                    if (!current) return false;
                    if (selectedBatch.endTime) return current.isAfter(dayjs(selectedBatch.endTime), 'day');
                    return false;
                  }}
                />
              </Form.Item>
            </>
          )}

          {selectedBatch.examMode === 'flexible' && (
            <Alert
              type="info"
              showIcon
              message="随到随考模式"
              description={`考生可在批次时间窗口内随时进入考试，考试时长 ${selectedBatch.examDuration} 分钟`}
              style={{ marginBottom: 16 }}
            />
          )}
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" onClick={handleNext} loading={loading}>
          下一步
        </Button>
      </div>
    </Form>
  );
}
