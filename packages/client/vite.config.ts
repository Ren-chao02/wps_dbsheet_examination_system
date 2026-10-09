import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import compression from 'compression';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    // dev server 启用 gzip：依赖预构建产物体积大（antd.js ~3.5MB），
    // 经内网穿透隧道访问时未压缩传输会导致页面加载极慢/超时
    {
      name: 'dev-server-gzip',
      configureServer(server) {
        server.middlewares.use(compression() as any);
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    // 允许内网穿透域名访问（花生壳/frp/CF Tunnel 等），dev 模式下 Vite 默认拦截未知 Host
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      // Socket.IO 走 Vite 代理，这样通过内网穿透域名访问时浏览器也能连上 WebSocket
      '/socket.io': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
