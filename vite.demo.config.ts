// بناء نسخة عرض تعمل بالكامل داخل المتصفح (بدون خادم) لنشرها كرابط واحد
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const shims: Record<string, string> = {
  express: 'src/demo/shims/express.js',
  'node:crypto': 'src/demo/shims/crypto.js',
  'node:fs': 'src/demo/shims/fs.js',
  'node:path': 'src/demo/shims/path.js',
  'node:sqlite': 'src/demo/shims/sqlite.js',
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'demo-shims',
      enforce: 'pre',
      resolveId(id) { return shims[id] ? path.resolve(shims[id]) : null; },
    },
  ],
  define: {
    'import.meta.env.VITE_DEMO': JSON.stringify('1'),
    'process.env': '{}',
  },
  build: {
    outDir: 'dist-demo',
    target: 'esnext',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { input: 'src/demo/index.html', output: { inlineDynamicImports: true } },
  },
});
