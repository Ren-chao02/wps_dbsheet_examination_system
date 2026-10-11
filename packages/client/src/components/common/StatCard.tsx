/**
 * StatCard —— 柔和多彩底的 KPI 指标卡（借鉴 WPS 教学平台工作台的分类色卡）。
 *
 * 与 antd <Statistic> 的区别：一块柔和的色底 + 大数字 + 右侧同色系图标，
 * 多个指标并排时用颜色区分类别（数字仍然最醒目），比白底单色卡更易扫读。
 * 颜色只作用于底色与图标，不作用于数字——避免颜色喧宾夺主。
 */
import type { CSSProperties, ReactNode } from 'react';

export type StatTone = 'blue' | 'purple' | 'cyan' | 'green' | 'orange' | 'pink';

interface StatCardProps {
  title: string;
  value: number | string;
  suffix?: string;
  icon: ReactNode;
  tone?: StatTone;
  /** 传入后整卡可点击（悬停上浮 + 手型） */
  onClick?: () => void;
  style?: CSSProperties;
}

export function StatCard({ title, value, suffix, icon, tone = 'blue', onClick, style }: StatCardProps) {
  return (
    <div
      className={`stat-card stat-card--${tone}${onClick ? ' stat-card--clickable' : ''}`}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="stat-card__body">
        <div className="stat-card__label">{title}</div>
        <div className="stat-card__value">
          {value}
          {suffix ? <span className="stat-card__suffix">{suffix}</span> : null}
        </div>
      </div>
      <div className="stat-card__icon">{icon}</div>
    </div>
  );
}
