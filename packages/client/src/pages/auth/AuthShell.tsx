import type { ReactNode } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import emblemWhite from '../../assets/snnu-emblem-white.png';
import './auth.css';

interface AuthShellProps {
  children: ReactNode;
}

/**
 * 登录相关页面的统一外壳：左侧学校品牌区 + 右侧内容插槽。
 *
 * 登录、WPS 首次绑定、注册关闭页共用，避免三个页面分别维护一套品牌样式。
 */
export function AuthShell({ children }: AuthShellProps) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#B50007',
          colorLink: '#B50007',
          borderRadius: 8,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
        },
      }}
    >
      <div className="auth-shell">
        <div className="auth-card">
        <aside className="auth-brand" aria-label="陕西师范大学多维表格考试系统">
          <div className="auth-brand__decor" aria-hidden="true">
            <span className="auth-brand__ring auth-brand__ring--one" />
            <span className="auth-brand__ring auth-brand__ring--two" />
            <span className="auth-brand__glow" />
          </div>

          <div className="auth-brand__top">
            <img className="auth-brand__emblem" src={emblemWhite} alt="陕西师范大学校徽" />
            <div>
              <div className="auth-brand__school">陕西师范大学</div>
              <div className="auth-brand__school-en">SHAANXI NORMAL UNIVERSITY</div>
            </div>
          </div>

          <div className="auth-brand__copy">
            <div className="auth-brand__kicker">EXAMINATION SYSTEM</div>
            <h1 className="auth-brand__title">
              多维表格
              <br />
              <span>考试系统</span>
            </h1>
            <p className="auth-brand__desc">
              在真实的 WPS 多维表格中完成操作题，交卷后由规则引擎逐条比对、自动判分。
            </p>
            <ul className="auth-brand__points">
              <li>真实表格环境，贴近实际办公场景</li>
              <li>每生一份卷子，同场等值不同题</li>
              <li>自动判分 + 人工复核，成绩可追溯</li>
            </ul>
          </div>

          <div className="auth-brand__motto">厚德 · 积学 · 励志 · 敦行</div>
        </aside>

        <main className="auth-main">
          <div className="auth-main__inner">{children}</div>
        </main>
        </div>
      </div>
    </ConfigProvider>
  );
}
