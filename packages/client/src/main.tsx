import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './index.css';

/**
 * 所有 antd 弹层统一挂到 document.body：
 * 避免弹层被局部滚动容器/固定(粘性)顶栏/overflow 裁剪，
 * 否则在部分电脑（存在滚动条）上会出现铃铛下拉、日期选择器等“打不开/看不见”。
 */
const popupContainer = () => document.body;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} getPopupContainer={popupContainer}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
);
