import { useEffect, useState, useMemo } from 'react';
import {
  Modal,
  Tree,
  Button,
  Input,
  Space,
  message,
  Popconfirm,
  Tag,
  Tooltip,
  Empty,
  Spin,
  Typography,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SearchOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import api from '../services/api';
import type { QuestionCategory } from '../types';

const { Text } = Typography;

interface CategoryModalProps {
  visible: boolean;
  onClose: () => void;
}

interface TreeNodeData {
  key: string;
  title: React.ReactNode;
  children?: TreeNodeData[];
  category: QuestionCategory;
}

function QuestionCountTag({ count }: { count?: number }) {
  if (!count && count !== 0) return null;
  return (
    <Tag style={{ fontSize: 11, lineHeight: '18px', padding: '0 6px', marginLeft: 8 }}>
      {count} 题
    </Tag>
  );
}

export function CategoryManagerModal({ visible, onClose }: CategoryModalProps) {
  const [treeData, setTreeData] = useState<TreeNodeData[]>([]);
  const [allCategories, setAllCategories] = useState<QuestionCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  // Edit/add modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editParent, setEditParent] = useState<QuestionCategory | null>(null);
  const [editTarget, setEditTarget] = useState<QuestionCategory | null>(null); // null = add, non-null = edit

  const totalQuestions = useMemo(
    () => allCategories.reduce((sum, c) => sum + (c.statistics?.totalQuestions || 0), 0),
    [allCategories],
  );

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await api.get('/categories?mode=tree&includeStats=true');
      const data = res.data?.data || [];

      const flatList: QuestionCategory[] = [];
      const collectFlat = (cats: any[]) => {
        cats.forEach((cat) => {
          flatList.push(cat);
          if (cat.children?.length) collectFlat(cat.children);
        });
      };
      collectFlat(data);
      setAllCategories(flatList);

      const convertToTreeData = (categories: any[]): TreeNodeData[] => {
        return categories.map((cat) => ({
          key: cat.id,
          title: (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', paddingRight: 4,
            }}>
              <span style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 14 }}>
                  {cat.name}
                </span>
                <QuestionCountTag count={cat.statistics?.totalQuestions} />
              </span>
              <span
                className="category-actions"
                onClick={(e) => e.stopPropagation()}
                style={{ opacity: 0, transition: 'opacity 0.2s' }}
              >
                <Space size={0}>
                  <Tooltip title="添加子分类">
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={(e) => { e.stopPropagation(); openAddChild(cat); }}
                    />
                  </Tooltip>
                  <Tooltip title="编辑">
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(e) => { e.stopPropagation(); openEdit(cat); }}
                    />
                  </Tooltip>
                  {(() => {
                    const canDelete = !cat.children?.length && !cat.statistics?.totalQuestions;
                    const reason = cat.children?.length
                      ? '该分类下还有子分类，请先删除子分类'
                      : cat.statistics?.totalQuestions
                        ? '该分类下还有题目，请先移走或删除题目'
                        : '删除该分类';
                    return (
                      <Tooltip title={reason}>
                        {canDelete ? (
                          <Popconfirm
                            title="确定删除该分类？"
                            description="删除后无法恢复"
                            onConfirm={(e) => { e?.stopPropagation(); handleDelete(cat.id); }}
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
                        ) : (
                          <Button
                            type="text"
                            size="small"
                            disabled
                            icon={<DeleteOutlined />}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </Tooltip>
                    );
                  })()}
                </Space>
              </span>
            </div>
          ),
          children: cat.children ? convertToTreeData(cat.children) : [],
          category: cat,
        }));
      };

      setTreeData(convertToTreeData(data));
      setExpandedKeys((prev) => prev.length ? prev : data.map((cat: any) => cat.id));
    } catch (error) {
      console.error('Error fetching categories:', error);
      message.error('加载分类失败');
    } finally {
      setLoading(false);
    }
  };

  const openAddRoot = () => {
    setEditTarget(null);
    setEditParent(null);
    setEditName('');
    setEditModalOpen(true);
  };

  const openAddChild = (parent: QuestionCategory) => {
    setEditTarget(null);
    setEditParent(parent);
    setEditName('');
    setEditModalOpen(true);
  };

  const openEdit = (category: QuestionCategory) => {
    setEditTarget(category);
    setEditParent(null);
    setEditName(category.name);
    setEditModalOpen(true);
  };

  const handleSave = async () => {
    if (!editName.trim()) {
      message.warning('请输入分类名称');
      return;
    }
    try {
      if (editTarget) {
        await api.put(`/categories/${editTarget.id}`, { name: editName.trim() });
        message.success('更新成功');
      } else if (editParent) {
        await api.post('/categories', {
          name: editName.trim(),
          parentId: editParent.id,
          sortOrder: (editParent.children?.length || 0) + 1,
        });
        message.success('添加成功');
      } else {
        await api.post('/categories', { name: editName.trim(), sortOrder: treeData.length + 1 });
        message.success('添加成功');
      }
      setEditModalOpen(false);
      fetchCategories();
    } catch (err: any) {
      message.error(err.response?.data?.message || '保存失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/categories/${id}`);
      message.success('删除成功');
      fetchCategories();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  useEffect(() => {
    if (visible) fetchCategories();
  }, [visible]);

  return (
    <>
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FolderOpenOutlined style={{ color: '#1890ff', fontSize: 18 }} />
            <span>知识点分类管理</span>
            <Tag>{allCategories.length} 个分类</Tag>
            {totalQuestions > 0 && <Text type="secondary" style={{ fontSize: 13 }}>共 {totalQuestions} 道题</Text>}
          </div>
        }
        open={visible}
        onCancel={onClose}
        width={700}
        footer={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchCategories}>刷新</Button>
            <Button onClick={onClose}>关闭</Button>
          </Space>
        }
        styles={{ body: { padding: '20px 24px', maxHeight: '60vh', overflow: 'auto' } }}
      >
        {/* Toolbar: search + add root */}
        <div style={{
          display: 'flex', gap: 12, marginBottom: 16,
          padding: '12px 16px', background: '#fafafa', borderRadius: 8,
        }}>
          <Input
            placeholder="搜索分类名称…"
            prefix={<SearchOutlined />}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            allowClear
            suffix={
              searchValue ? (
                <ClearOutlined
                  style={{ cursor: 'pointer', color: '#999' }}
                  onClick={() => setSearchValue('')}
                />
              ) : null
            }
            style={{ flex: 1 }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openAddRoot}>
            添加一级分类
          </Button>
        </div>

        {/* Tree */}
        <Spin spinning={loading}>
          {treeData.length > 0 ? (
            <>
              <style>{`
                .ant-tree-treenode:hover .category-actions {
                  opacity: 1 !important;
                }
              `}</style>
              <Tree
                showIcon
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys as string[])}
                treeData={treeData}
                icon={({ expanded }) =>
                  expanded ? (
                    <FolderOpenOutlined style={{ color: '#1890ff' }} />
                  ) : (
                    <FolderOutlined style={{ color: '#8c8c8c' }} />
                  )
                }
                blockNode
              />
            </>
          ) : (
            <Empty
              description="暂无分类数据"
              style={{ padding: '40px 0' }}
            >
              <Button type="primary" icon={<PlusOutlined />} onClick={openAddRoot}>
                创建第一个分类
              </Button>
            </Empty>
          )}
        </Spin>
      </Modal>

      {/* Edit/Add Modal */}
      <Modal
        title={
          editTarget
            ? `编辑分类「${editTarget.name}」`
            : editParent
              ? `在「${editParent.name}」下添加子分类`
              : '添加一级分类'
        }
        open={editModalOpen}
        onOk={handleSave}
        onCancel={() => setEditModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={420}
        destroyOnClose
      >
        <Input
          placeholder="请输入分类名称"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onPressEnter={handleSave}
          autoFocus
          maxLength={128}
          showCount
          size="large"
        />
      </Modal>
    </>
  );
}
