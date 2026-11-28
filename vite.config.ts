import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'dev-hmr-csp',
      apply: 'serve',
      transformIndexHtml(html) {
        return html.replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:*");
      },
    },
  ],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
