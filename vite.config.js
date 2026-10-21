import { defineConfig } from 'vite';

// Puerto del servidor de salas (ver scripts/dev-server.js). Cambiarlo permite correr dos copias.
const game = `http://127.0.0.1:${process.env.GAME_PORT || 8787}`;

export default defineConfig({
  server: {
    // host: true deja entrar desde el celular u otras PCs de tu red (Wi-Fi).
    host: true,
    port: 5173,
    proxy: {
      '/ws': { target: game, ws: true },
      '/api': { target: game },
    },
  },
});
