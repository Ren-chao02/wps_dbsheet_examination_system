import { useState } from 'react';
import { Steps, Button, Upload, Result, message, Typography, Space, Card } from 'antd';
import { InboxOutlined, DownloadOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

const { Dragger } = Upload;
const { Text, Paragraph } = Typography;

interface ImportResult {
  taskId: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  status: string;
}

export default function StudentImport() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [fileList, setFileList] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Step 1: Download template
  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/students/import-template', {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', '学生导入模板.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      message.error('下载模板失败');
    }
  };

  // Step 3: Start import
  const handleImport = async () => {
    if (fileList.length === 0) {
      message.warning('请先上传文件');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', fileList[0].originFileObj || fileList[0]);
      const res = await api.post<ImportResult>('/students/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(res.data);
      setCurrent(3);
      message.success('导入完成');
    } catch (err: any) {
      message.error(err.response?.data?.message || '导入失败');
    } finally {
      setUploading(false);
    }
  };

  // Download error file from result
  const handleDownloadErrors = async () => {
    if (!importResult) return;
    try {
      const response = await api.get(`/import-tasks/${importResult.taskId}/error-file`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', '导入失败记录.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      message.error('下载失败记录失败');
    }
  };

  const steps = [
    {
      title: '下载模板',
      content: (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Paragraph>
            请先下载导入模板，按照模板格式填写学生信息后上传。
          </Paragraph>
          <Paragraph type="secondary">
            模板包含字段：学号、姓名、性别、手机号、邮箱、班级编码
          </Paragraph>
          <Button type="primary" icon={<DownloadOutlined />} size="large" onClick={handleDownloadTemplate}>
            下载导入模板
          </Button>
        </div>
      ),
    },
    {
      title: '上传文件',
      content: (
        <div style={{ padding: '20px 0' }}>
          <Dragger
            accept=".xlsx,.xls,.csv"
            maxCount={1}
            fileList={fileList}
            beforeUpload={(file) => {
              const isValidType = [
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.ms-excel',
                'text/csv',
              ].includes(file.type) || /\.(xlsx|xls|csv)$/i.test(file.name);
              if (!isValidType) {
                message.error('仅支持 .xlsx、.xls、.csv 格式文件');
                return Upload.LIST_IGNORE;
              }
              const isLt5M = file.size / 1024 / 1024 < 5;
              if (!isLt5M) {
                message.error('文件大小不能超过 5MB');
                return Upload.LIST_IGNORE;
              }
              setFileList([file]);
              return false; // prevent auto upload
            }}
            onRemove={() => {
              setFileList([]);
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
            <p className="ant-upload-hint">
              支持 .xlsx、.xls、.csv 格式，文件大小不超过 5MB
            </p>
          </Dragger>
        </div>
      ),
    },
    {
      title: '确认导入',
      content: (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          {fileList.length > 0 ? (
            <>
              <Paragraph>
                待导入文件：<Text strong>{fileList[0].name}</Text>
              </Paragraph>
              <Paragraph>
                文件大小：<Text strong>{(fileList[0].size / 1024).toFixed(1)} KB</Text>
              </Paragraph>
              <Button
                type="primary"
                size="large"
                loading={uploading}
                onClick={handleImport}
              >
                开始导入
              </Button>
            </>
          ) : (
            <Paragraph type="warning">未选择文件，请返回上一步上传文件</Paragraph>
          )}
        </div>
      ),
    },
    {
      title: '导入结果',
      content: importResult ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          {importResult.failedRows === 0 ? (
            <Result
              icon={<CheckCircleOutlined />}
              status="success"
              title="导入完成"
              subTitle={
                <Space direction="vertical">
                  <Text>总行数：{importResult.totalRows}</Text>
                  <Text type="success">成功：{importResult.successRows}</Text>
                  <Text type="secondary">失败：{importResult.failedRows}</Text>
                </Space>
              }
              extra={
                <Button type="primary" onClick={() => navigate('/teacher/students')}>
                  返回学生列表
                </Button>
              }
            />
          ) : (
            <Result
              icon={<CloseCircleOutlined />}
              status="warning"
              title="导入完成（部分失败）"
              subTitle={
                <Space direction="vertical">
                  <Text>总行数：{importResult.totalRows}</Text>
                  <Text type="success">成功：{importResult.successRows}</Text>
                  <Text type="danger">失败：{importResult.failedRows}</Text>
                </Space>
              }
              extra={
                <Space>
                  <Button onClick={handleDownloadErrors}>下载失败记录</Button>
                  <Button type="primary" onClick={() => navigate('/teacher/students')}>
                    返回学生列表
                  </Button>
                </Space>
              }
            />
          )}
        </div>
      ) : null,
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>批量导入学生</h2>
        <Button onClick={() => navigate('/teacher/students')}>返回学生列表</Button>
      </div>

      <Card>
        <Steps current={current} items={steps.map(s => ({ title: s.title }))} style={{ marginBottom: 32 }} />

        <div style={{ minHeight: 200 }}>{steps[current].content}</div>

        {current < 3 && (
          <div style={{ textAlign: 'right', marginTop: 24 }}>
            {current > 0 && (
              <Button style={{ marginRight: 8 }} onClick={() => setCurrent(current - 1)}>
                上一步
              </Button>
            )}
            {current < 2 && (
              <Button type="primary" onClick={() => setCurrent(current + 1)} disabled={current === 1 && fileList.length === 0}>
                下一步
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
