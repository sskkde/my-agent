import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const webPort = Number(process.env.VITE_PORT ?? 3002);
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:3003';

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    strictPort: true,
    allowedHosts: ['agent.nas-1.club'],
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true
      }
    }
  }
});
