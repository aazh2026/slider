import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        // @ppt/core 是 workspace 内的源码包（前后端共享同一份实现）。
        // 直接指向源码，Vite 不需要预打包，也不会出现两份拷贝。
        '@ppt/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        // 前端在 dev 模式下把 /api 打到后端 Hono 服务
        '/api': {
          target: process.env.API_ORIGIN || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
