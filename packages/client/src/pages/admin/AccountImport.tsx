import { useState } from 'react';
import { Steps, Button, Upload, message, Result, Typography, Space, Card } from 'antd';
import {
  DownloadOutlined, UploadOutlined, CheckCircleOutlined,
  InboxOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { UploadProps } from 'antd';
import api from '../../services/api';

const { Text, Paragraph } = Typography;

interface ImportResult {
  taskId: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
}

export default function AccountImport() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/accounts/import-template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', '账户导入模板.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      message.success('模板下载成功');
    } catch {
      message.error('模板下载失败');
    }
  };

  const uploadProps: UploadProps = {
    accept: '.xlsx,.xls',
    maxCount: 1,
    beforeUpload: (file) => {
      setUploadedFile(file);
      return false; // prevent auto upload
    },
    onRemove: () => {
      setUploadedFile(null);
    },
    fileList: uploadedFile ? [{
      uid: '-1',
      name: uploadedFile.name,
      status: 'done',
      size: uploadedFile.size,
    } as any] : [],
  };

  const handleUpload = async () => {
    if (!uploadedFile) {
      message.warning('请先选择文件');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadedFile);
      const res = await api.post('/accounts/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data);
      setCurrentStep(2);
      message.success('导入完成');
    } catch (err: any) {
      message.error(err.response?.data?.message || '导入失败');
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    setCurrentStep(0);
    setUploadedFile(null);
    setResult(null);
  };

  const handleBackToList = () => {
    navigate('/admin/accounts');
  };

  return (
    <div className="page-container">
      <div style={{ marginBottom: 24 }}>
        <h2>批量导入账户</h2>
      </div>

      <Card>
        <Steps
          current={currentStep}
          style={{ marginBottom: 32 }}
          items={[
            { title: '下载模板', description: '获取导入模板' },
            { title: '上传文件', description: '选择并上传 Excel' },
            { title: '导入结果', description: '查看导入报告' },
          ]}
        />

        {/* Step 0: Download Template */}
        {currentStep === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <DownloadOutlined style={{ fontSize: 48, color: '#1890ff', marginBottom: 16 }} />
            <h3>第一步：下载导入模板</h3>
            <Paragraph type="secondary" style={{ maxWidth: 480, margin: '0 auto 24px' }}>
              请先下载标准导入模板，按照模板格式填写账户信息后上传。
              模板包含字段：用户名(必填)、密码(必填)、姓名、WPSID、邮箱、角色编码。
            </Paragraph>
            <Space>
              <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
                下载模板
              </Button>
              <Button onClick={() => setCurrentStep(1)}>
                已有模板，下一步
              </Button>
            </Space>
          </div>
        )}

        {/* Step 1: Upload File */}
        {currentStep === 1 && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <UploadOutlined style={{ fontSize: 48, color: '#1890ff', marginBottom: 16 }} />
            <h3>第二步：上传填写好的文件</h3>
            <Paragraph type="secondary" style={{ maxWidth: 480, margin: '0 auto 24px' }}>
              选择已按模板格式填写好的 Excel 文件进行上传。系统将自动解析并导入账户数据。
            </Paragraph>
            <div style={{ maxWidth: 400, margin: '0 auto 24px' }}>
              <Upload.Dragger {...uploadProps}>
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
                <p className="ant-upload-hint">支持 .xlsx 和 .xls 格式</p>
              </Upload.Dragger>
            </div>
            <Space>
              <Button
                type="primary"
                icon={<UploadOutlined />}
                loading={uploading}
                disabled={!uploadedFile}
                onClick={handleUpload}
              >
                开始导入
              </Button>
              <Button onClick={() => setCurrentStep(0)}>上一步</Button>
            </Space>
          </div>
        )}

        {/* Step 2: Result */}
        {currentStep === 2 && result && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Result
              status={result.failedRows === 0 ? 'success' : result.failedRows === result.totalRows ? 'error' : 'warning'}
              title="导入完成"
              subTitle={
                <Space direction="vertical" size={4}>
                  <Text>总行数: <Text strong>{result.totalRows}</Text></Text>
                  <Text style={{ color: '#52c41a' }}>成功: <Text strong>{result.successRows}</Text></Text>
                  {result.failedRows > 0 && (
                    <Text style={{ color: '#ff4d4f' }}>失败: <Text strong>{result.failedRows}</Text></Text>
                  )}
                </Space>
              }
              extra={
                <Space>
                  <Button type="primary" onClick={handleBackToList}>返回账户列表</Button>
                  <Button icon={<ReloadOutlined />} onClick={handleReset}>继续导入</Button>
                </Space>
              }
            />
          </div>
        )}
      </Card>
    </div>
  );
}
