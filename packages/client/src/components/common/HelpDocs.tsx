/**
 * 帮助文档入口与查看器
 *
 * 文档以 PDF 形式托管在 public/help/ 下（dev 与生产均通过 /help/xxx.pdf 访问），
 * 使用浏览器原生查看器打开，无需引入额外依赖。
 * 注意：不能放在 public/docs/ 下，.gitignore 的 `docs/` 规则会把该目录整体忽略。
 */

import { Dropdown, Tooltip } from 'antd';
import { QuestionCircleOutlined, FileTextOutlined } from '@ant-design/icons';

export type HelpDocRole = 'student' | 'teacher' | 'admin';

export interface HelpDocItem {
  key: string;
  label: string;
  url: string;
  description: string;
  /** 可见该文档的角色 */
  roles: HelpDocRole[];
}

export const HELP_DOCS: HelpDocItem[] = [
  {
    key: 'user-manual',
    label: '系统使用说明书',
    url: '/help/user-manual.pdf',
    description: '面向学生与教师的完整操作指南',
    roles: ['student', 'teacher', 'admin'],
  },
  {
    key: 'wps-token-guide',
    label: 'WPS Token 获取详细步骤',
    url: '/help/wps-token-guide.pdf',
    description: '配置 WPS 授权时获取 access_token 的图文步骤',
    roles: ['teacher', 'admin'],
  },
];

export function getHelpDocsByRole(role: HelpDocRole): HelpDocItem[] {
  return HELP_DOCS.filter(doc => doc.roles.includes(role));
}

/** 在新标签页用浏览器原生查看器打开 PDF */
export function openHelpDoc(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

const iconBtnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: '#86868b',
  transition: 'all 0.15s cubic-bezier(0,0,0.2,1)',
};

/**
 * 顶栏「帮助」入口：按角色展示可访问的文档。
 * 仅一份文档时点击直接打开，多份时展开下拉菜单。
 */
export function HelpDocsMenu({ role }: { role: HelpDocRole }) {
  const docs = getHelpDocsByRole(role);
  if (docs.length === 0) return null;

  if (docs.length === 1) {
    const [doc] = docs;
    return (
      <Tooltip title={doc.label} placement="bottom">
        <div
          style={iconBtnStyle}
          onClick={() => openHelpDoc(doc.url)}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <QuestionCircleOutlined style={{ fontSize: 18 }} />
        </div>
      </Tooltip>
    );
  }

  return (
    <Tooltip title="帮助文档" placement="bottom">
      <Dropdown
        placement="bottomRight"
        menu={{
          items: docs.map(doc => ({
            key: doc.key,
            icon: <FileTextOutlined />,
            label: doc.label,
            onClick: () => openHelpDoc(doc.url),
          })),
        }}
      >
        <div
          style={iconBtnStyle}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <QuestionCircleOutlined style={{ fontSize: 18 }} />
        </div>
      </Dropdown>
    </Tooltip>
  );
}