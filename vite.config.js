import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // host: true deja entrar desde el celular u otras PCs de tu red (Wi-Fi).
    host: true,
    port: 5173,
    proxy: {
      '/ws': { target: 'http://127.0.0.1:8787', ws: true },
      '/api': { target: 'http://127.0.0.1:8787' },
    },
  },
});
