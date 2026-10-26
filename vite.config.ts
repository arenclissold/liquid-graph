import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./demo/index.html', import.meta.url)),
        chartjs: fileURLToPath(new URL('./demo/chartjs.html', import.meta.url)),
      },
    },
  },
});
