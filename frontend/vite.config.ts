import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';

const httpsEnabled = process.env.KDX_FRONTEND_HTTPS === 'true';
const httpsKey = process.env.KDX_FRONTEND_HTTPS_KEY ?? './certs/kdx-sdt-dev.key';
const httpsCert = process.env.KDX_FRONTEND_HTTPS_CERT ?? './certs/kdx-sdt-dev.crt';
const proxyTarget = process.env.KDX_BACKEND_PROXY_TARGET ?? 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    https:
      httpsEnabled && fs.existsSync(httpsKey) && fs.existsSync(httpsCert)
        ? {
            key: fs.readFileSync(httpsKey),
            cert: fs.readFileSync(httpsCert),
          }
        : undefined,
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
});
