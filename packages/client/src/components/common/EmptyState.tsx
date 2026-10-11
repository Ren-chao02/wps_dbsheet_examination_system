/**
 * EmptyState —— 统一的空状态：插画 + 一句话 + 引导按钮。
 *
 * 借鉴 WPS 教学平台：「暂无场次」这类空状态不只是空白提示，而是给出下一步动作
 * （如"请先添加场次"+ 按钮），降低教师/学生卡在空页面的概率。
 * 插画用内联 SVG（不引外部素材），色调跟随 Apple 令牌。
 */
import type { CSSProperties, ReactNode } from 'react';
import { Button } from 'antd';

interface EmptyStateProps {
  /** 一句话主文案，如「暂无待完成的考试」 */
  title?: string;
  /** 补充说明（可选，给出行动指引） */
  description?: string;
  /** 引导按钮文案；与 onAction 同时提供才渲染 */
  actionText?: string;
  onAction?: () => void;
  /** 自定义插画（默认是文档插画） */
  illustration?: ReactNode;
  style?: CSSProperties;
}

/** 默认插画：一张淡色文档 + 三个圆点，风格与 antd Empty 的灰度调一致 */
function DefaultIllustration() {
  return (
    <svg width="112" height="88" viewBox="0 0 112 88" fill="none" aria-hidden="true">
      <ellipse cx="56" cy="76" rx="44" ry="7" fill="#007aff" opacity="0.06" />
      <rect x="30" y="8" width="52" height="62" rx="8" fill="#f0f2f7" stroke="#e0e3ea" strokeWidth="1.5" />
      <path d="M70 8 L82 20 L70 20 Z" fill="#dde1ea" />
      <rect x="38" y="30" width="36" height="4" rx="2" fill="#c9cedb" />
      <rect x="38" y="40" width="28" height="4" rx="2" fill="#d6dae4" />
      <circle cx="42" cy="54" r="3" fill="#007aff" opacity="0.35" />
      <circle cx="53" cy="54" r="3" fill="#007aff" opacity="0.22" />
      <circle cx="64" cy="54" r="3" fill="#007aff" opacity="0.35" />
    </svg>
  );
}

export function EmptyState({ title = '暂无数据', description, actionText, onAction, illustration, style }: EmptyStateProps) {
  return (
    <div className="empty-state" style={style}>
      <div className="empty-state__illustration">{illustration ?? <DefaultIllustration />}</div>
      <div className="empty-state__title">{title}</div>
      {description ? <div className="empty-state__description">{description}</div> : null}
      {actionText && onAction ? (
        <Button type="primary" onClick={onAction} style={{ marginTop: 16 }}>
          {actionText}
        </Button>
      ) : null}
    </div>
  );
}
