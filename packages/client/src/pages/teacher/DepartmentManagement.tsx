import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Card, Row, Col, Tree, Input, Button, Form, Empty, message, Popconfirm,
  Space, Badge, Divider, Spin,
} from 'antd';
import {
  PlusOutlined, BankOutlined, BookOutlined, TeamOutlined,
  DeleteOutlined, SearchOutlined,
} from '@ant-design/icons';
import type { TreeProps } from 'antd';
import type { DataNode } from 'antd/es/tree';
import api from '../../services/api';
import type { Department, Major, ClassRoom } from '../../types';

type NodeType = 'dept' | 'major' | 'class';

interface SelectedNode {
  type: NodeType;
  id: string;
  data: Department | Major | ClassRoom;
}

const nodeTypeLabel: Record<NodeType, string> = {
  dept: '院系',
  major: '专业',
  class: '班级',
};

function getNodeKey(type: NodeType, id: string) {
  return `${type}-${id}`;
}

function parseNodeKey(key: string): { type: NodeType; id: string } {
  const idx = key.indexOf('-');
  return { type: key.slice(0, idx) as NodeType, id: key.slice(idx + 1) };
}

export default function DepartmentManagement() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchValue, setSearchValue] = useState('');
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  // ---------- Data fetching ----------
  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: Department[] }>('/departments');
      setDepartments(res.data.data);
    } catch {
      message.error('加载院系架构失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  // ---------- Build tree data ----------
  const treeData = useMemo<DataNode[]>(() => {
    const filter = searchValue.toLowerCase();

    const buildClassNodes = (cls: ClassRoom): DataNode | null => {
      if (filter && !cls.name.toLowerCase().includes(filter) && !cls.code.toLowerCase().includes(filter)) return null;
      return {
        key: getNodeKey('class', cls.id),
        title: cls.name,
        icon: <TeamOutlined />,
        isLeaf: true,
      };
    };

    const buildMajorNodes = (major: Major): DataNode | null => {
      const children = (major.classRooms || []).map(buildClassNodes).filter(Boolean) as DataNode[];
      if (filter && !major.name.toLowerCase().includes(filter) && !major.code.toLowerCase().includes(filter) && children.length === 0) return null;
      return {
        key: getNodeKey('major', major.id),
        title: major.name,
        icon: <BookOutlined />,
        children: children.length > 0 ? children : undefined,
      };
    };

    const buildDeptNodes = (dept: Department): DataNode | null => {
      const children = (dept.majors || []).map(buildMajorNodes).filter(Boolean) as DataNode[];
      if (filter && !dept.name.toLowerCase().includes(filter) && !dept.code.toLowerCase().includes(filter) && children.length === 0) return null;
      return {
        key: getNodeKey('dept', dept.id),
        title: dept.name,
        icon: <BankOutlined />,
        children: children.length > 0 ? children : undefined,
      };
    };

    return departments.map(buildDeptNodes).filter(Boolean) as DataNode[];
  }, [departments, searchValue]);

  // ---------- Selected node helpers ----------
  const findDepartment = (id: string) => departments.find(d => d.id === id);
  const findMajor = (deptId: string, majorId: string) =>
    departments.find(d => d.id === deptId)?.majors?.find(m => m.id === majorId);
  const findClassRoom = (deptId: string, majorId: string, classId: string) =>
    departments.find(d => d.id === deptId)?.majors?.find(m => m.id === majorId)?.classRooms?.find(c => c.id === classId);

  const resolveNode = useCallback((type: NodeType, id: string): Department | Major | ClassRoom | undefined => {
    if (type === 'dept') return findDepartment(id);
    // For major / class we need to search through the tree
    for (const dept of departments) {
      if (type === 'major') {
        const major = dept.majors?.find(m => m.id === id);
        if (major) return major;
      }
      if (type === 'class') {
        for (const major of dept.majors || []) {
          const cls = major.classRooms?.find(c => c.id === id);
          if (cls) return cls;
        }
      }
    }
    return undefined;
  }, [departments]);

  // ---------- Tree selection ----------
  const handleSelect: TreeProps['onSelect'] = (keys) => {
    if (keys.length === 0) return;
    const { type, id } = parseNodeKey(keys[0] as string);
    const data = resolveNode(type, id);
    if (!data) return;
    setSelectedNode({ type, id, data });
    // Populate form
    if (type === 'dept') {
      form.setFieldsValue({ name: data.name, code: data.code, description: (data as Department).description, sortOrder: (data as Department).sortOrder });
    } else if (type === 'major') {
      form.setFieldsValue({ name: data.name, code: data.code, description: (data as Major).description, sortOrder: (data as Major).sortOrder });
    } else {
      const cls = data as ClassRoom;
      form.setFieldsValue({ name: cls.name, code: cls.code, academicYear: cls.academicYear, gradeLevel: cls.gradeLevel });
    }
  };

  // ---------- CRUD ----------
  const handleSave = async () => {
    if (!selectedNode) return;
    try {
      setSaving(true);
      const values = await form.validateFields();
      if (selectedNode.type === 'dept') {
        await api.put(`/departments/${selectedNode.id}`, values);
      } else if (selectedNode.type === 'major') {
        await api.put(`/departments/majors/${selectedNode.id}`, values);
      } else {
        await api.put(`/departments/classrooms/${selectedNode.id}`, values);
      }
      message.success('保存成功');
      fetchTree();
    } catch (err: any) {
      if (err.response) {
        message.error(err.response?.data?.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAddDepartment = async () => {
    try {
      await api.post('/departments', { name: '新院系', code: 'NEW_DEPT' });
      message.success('院系已创建，请在右侧编辑详情');
      fetchTree();
    } catch (err: any) {
      message.error(err.response?.data?.message || '创建失败');
    }
  };

  const handleAddChild = async (parentId: string, parentType: NodeType) => {
    try {
      if (parentType === 'dept') {
        await api.post(`/departments/${parentId}/majors`, { name: '新专业', code: 'NEW_MAJOR', departmentId: parentId });
        message.success('专业已创建');
      } else if (parentType === 'major') {
        await api.post(`/departments/majors/${parentId}/classrooms`, { name: '新班级', code: 'NEW_CLASS', majorId: parentId, academicYear: '2026', gradeLevel: 1 });
        message.success('班级已创建');
      }
      fetchTree();
    } catch (err: any) {
      message.error(err.response?.data?.message || '创建失败');
    }
  };

  const handleDelete = async () => {
    if (!selectedNode) return;
    try {
      if (selectedNode.type === 'dept') {
        await api.delete(`/departments/${selectedNode.id}`);
      } else if (selectedNode.type === 'major') {
        await api.delete(`/departments/majors/${selectedNode.id}`);
      } else {
        await api.delete(`/departments/classrooms/${selectedNode.id}`);
      }
      message.success('删除成功');
      setSelectedNode(null);
      form.resetFields();
      fetchTree();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  // ---------- Title render ----------
  const titleRender = (nodeData: DataNode) => {
    const { type, id } = parseNodeKey(nodeData.key as string);
    const data = resolveNode(type, id);
    const studentCount = type === 'class' ? (data as ClassRoom)?.studentCount : undefined;

    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span>{nodeData.title as string}</span>
        {studentCount !== undefined && studentCount > 0 && (
          <Badge count={studentCount} style={{ backgroundColor: '#1890ff' }} size="small" />
        )}
        <Space size={4} style={{ marginLeft: 4 }} onClick={(e) => e.stopPropagation()}>
          {type !== 'class' && (
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => handleAddChild(id, type)}
              title={type === 'dept' ? '新增专业' : '新增班级'}
            />
          )}
          <Popconfirm
            title={`确定删除该${nodeTypeLabel[type]}？${type !== 'class' ? '其下所有子级也将被删除。' : ''}`}
            onConfirm={handleDelete}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              title={`删除${nodeTypeLabel[type]}`}
              onClick={(e) => {
                e.stopPropagation();
                // Ensure this node is selected before deleting
                const nodeData = resolveNode(type, id);
                if (nodeData) {
                  setSelectedNode({ type, id, data: nodeData });
                }
              }}
            />
          </Popconfirm>
        </Space>
      </span>
    );
  };

  // ---------- Edit form ----------
  const renderEditForm = () => {
    if (!selectedNode) {
      return <Empty description="请选择左侧节点进行编辑" />;
    }

    const { type } = selectedNode;

    return (
      <Card
        title={`编辑${nodeTypeLabel[type]}`}
        extra={
          <Popconfirm
            title={`确定删除该${nodeTypeLabel[type]}？${type !== 'class' ? '其下所有子级也将被删除。' : ''}`}
            onConfirm={handleDelete}
            okText="确定"
            cancelText="取消"
          >
            <Button danger icon={<DeleteOutlined />} size="small">删除</Button>
          </Popconfirm>
        }
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="编码" rules={[{ required: true, message: '请输入编码' }]}>
            <Input />
          </Form.Item>

          {type === 'dept' && (
            <>
              <Form.Item name="description" label="描述">
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item name="sortOrder" label="排序">
                <Input type="number" />
              </Form.Item>
            </>
          )}

          {type === 'major' && (
            <>
              <Form.Item name="description" label="描述">
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item name="sortOrder" label="排序">
                <Input type="number" />
              </Form.Item>
            </>
          )}

          {type === 'class' && (
            <>
              <Form.Item name="academicYear" label="学年" rules={[{ required: true, message: '请输入学年' }]}>
                <Input placeholder="如 2026" />
              </Form.Item>
              <Form.Item name="gradeLevel" label="年级" rules={[{ required: true, message: '请输入年级' }]}>
                <Input type="number" placeholder="如 1" />
              </Form.Item>
            </>
          )}

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>保存</Button>
          </Form.Item>
        </Form>
      </Card>
    );
  };

  // ---------- Render ----------
  return (
    <div className="page-container">
      <Card
        title="院系架构管理"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAddDepartment}>
            新增院系
          </Button>
        }
      >
        <Row gutter={16}>
          <Col span={8} style={{ borderRight: '1px solid #f0f0f0', paddingRight: 16 }}>
            <Input.Search
              placeholder="搜索院系/专业/班级"
              allowClear
              prefix={<SearchOutlined />}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              style={{ marginBottom: 16 }}
            />
            <Spin spinning={loading}>
              {treeData.length > 0 ? (
                <Tree
                  showIcon
                  defaultExpandAll
                  treeData={treeData}
                  onSelect={handleSelect}
                  titleRender={titleRender}
                  selectedKeys={selectedNode ? [getNodeKey(selectedNode.type, selectedNode.id)] : []}
                />
              ) : (
                <Empty description={loading ? '加载中...' : '暂无院系数据'} />
              )}
            </Spin>
          </Col>
          <Col span={16}>
            {renderEditForm()}
          </Col>
        </Row>
      </Card>
    </div>
  );
}
