import { useEffect, useState } from 'react';
import {
  Modal,
  Tree,
  Button,
  Input,
  Space,
  message,
  Popconfirm,
  Card,
  Tag,
  Tooltip,
  Empty,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  SettingOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import api from '../services/api';
import type { QuestionCategory } from '../types';

interface CategoryModalProps {
  visible: boolean;
  onClose: () => void;
}

// 树节点数据结构
interface TreeNodeData {
  key: string;
  title: React.ReactNode;
  children?: TreeNodeData[];
  category: QuestionCategory;
}

export function CategoryManagerModal({ visible, onClose }: CategoryModalProps) {
  const [treeData, setTreeData] = useState<TreeNodeData[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingNode, setEditingNode] = useState<QuestionCategory | null>(null);
  const [isAddingChild, setIsAddingChild] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  // 获取分类树数据
  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await api.get('/categories?mode=tree&includeStats=true');
      const data = res.data?.data || [];
      
      // 转换为树形结构
      const convertToTreeData = (categories: any[]): TreeNodeData[] => {
        return categories.map((cat) => ({
          key: cat.id,
          title: (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: 200 }}>
              <span>
                {cat.name}
              </span>
              <Space size="small" onClick={(e) => e.stopPropagation()}>
                <Tooltip title="添加子分类">
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddChild(cat);
                    }}
                  />
                </Tooltip>
                <Tooltip title="编辑">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(cat);
                    }}
                  />
                </Tooltip>
                {(cat._childrenCount === 0 || cat._childrenCount === undefined) && (
                  <Tooltip title="删除">
                    <Popconfirm
                      title="确定删除该分类？"
                      description="删除后无法恢复"
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        handleDelete(cat.id);
                      }}
                      okText="确定"
                      cancelText="取消"
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>
                  </Tooltip>
                )}
              </Space>
            </div>
          ),
          children: cat.children ? convertToTreeData(cat.children) : [],
          category: cat,
        }));
      };

      setTreeData(convertToTreeData(data));
      
      // 默认展开所有一级分类
      setExpandedKeys(data.map((cat: any) => cat.id));
    } catch (error) {
      console.error('Error fetching categories:', error);
      message.error('加载分类失败');
    } finally {
      setLoading(false);
    }
  };

  // 添加根级分类
  const handleAddRoot = async () => {
    if (!newCategoryName.trim()) {
      message.warning('请输入分类名称');
      return;
    }

    try {
      await api.post('/categories', {
        name: newCategoryName.trim(),
        sortOrder: treeData.length + 1,
      });
      message.success('添加成功');
      setNewCategoryName('');
      fetchCategories();
    } catch (err: any) {
      message.error(err.response?.data?.message || '添加失败');
    }
  };

  // 添加子分类
  const handleAddChild = (parent: QuestionCategory) => {
    setEditingNode(parent);
    setIsAddingChild(true);
    setNewCategoryName('');
    // 显示输入框（通过Modal或内联方式）
    showModalInput(parent);
  };

  // 编辑分类
  const handleEdit = (category: QuestionCategory) => {
    setEditingNode(category);
    setIsAddingChild(false);
    setNewCategoryName(category.name);
    showModalInput(category);
  };

  // 删除分类
  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/categories/${id}`);
      message.success('删除成功');
      fetchCategories();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  // 保存编辑/新增
  const handleSave = async () => {
    if (!newCategoryName.trim()) {
      message.warning('请输入分类名称');
      return;
    }

    try {
      if (isAddingChild && editingNode) {
        // 添加子分类
        await api.post('/categories', {
          name: newCategoryName.trim(),
          parentId: editingNode.id,
          sortOrder: (editingNode.children?.length || 0) + 1,
        });
        message.success('添加成功');
      } else if (editingNode) {
        // 更新现有分类
        await api.put(`/categories/${editingNode.id}`, {
          name: newCategoryName.trim(),
        });
        message.success('更新成功');
      }

      setEditingNode(null);
      setIsAddingChild(false);
      setNewCategoryName('');
      fetchCategories();
    } catch (err: any) {
      message.error(err.response?.data?.message || '保存失败');
    }
  };

  // 内联编辑状态管理
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);

  const showModalInput = (category: QuestionCategory) => {
    setInlineEditingId(category.id);
    setNewCategoryName(isAddingChild ? '' : category.name);
  };

  useEffect(() => {
    if (visible) {
      fetchCategories();
    }
  }, [visible]);

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SettingOutlined style={{ color: '#1890ff' }} />
          <span>知识点分类管理</span>
        </div>
      }
      open={visible}
      onCancel={onClose}
      width={800}
      footer={[
        <Button key="refresh" icon={<ReloadOutlined />} onClick={fetchCategories}>
          刷新
        </Button>,
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
      ]}
    >
      {/* 添加根级分类 */}
      <Card
        size="small"
        style={{ marginBottom: 16, background: '#fafafa' }}
        bodyStyle={{ padding: '12px 16px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Input
            placeholder="输入新的一级分类名称"
            value={newCategoryName && !inlineEditingId ? newCategoryName : ''}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onPressEnter={handleAddRoot}
            style={{ maxWidth: 300 }}
            allowClear
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAddRoot}
            disabled={!newCategoryName.trim() || !!inlineEditingId}
          >
            添加一级分类
          </Button>
          <Tag color="processing">提示：点击分类右侧的 + 可添加二级分类</Tag>
        </div>
      </Card>

      {/* 分类树 */}
      <Spin spinning={loading}>
        {treeData.length > 0 ? (
          <Tree
            showIcon
            defaultExpandAll
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys as string[])}
            treeData={treeData}
            switcherIcon={<FolderOpenOutlined />}
            blockNode
          />
        ) : (
          <Empty description="暂无分类数据，请添加" />
        )}
      </Spin>

      {/* 内联编辑弹窗 */}
      <Modal
        title={isAddingChild ? `在「${editingNode?.name}」下添加子分类` : `编辑分类「${editingNode?.name}」`}
        open={!!inlineEditingId}
        onCancel={() => {
          setInlineEditingId(null);
          setEditingNode(null);
          setNewCategoryName('');
        }}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        width={400}
      >
        <Input
          placeholder="请输入分类名称"
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          onPressEnter={handleSave}
          autoFocus
          maxLength={128}
          showCount
        />
      </Modal>
    </Modal>
  );
}
