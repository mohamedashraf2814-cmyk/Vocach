// يبني نسخة العرض (تعمل داخل المتصفح بدون خادم) ويدمجها في ملف HTML واحد:
// - dist-demo/vocach-demo.html : لنشرها كرابط Artifact على claude.ai
// - dist-web/index.html        : لنشرها على أي استضافة ملفات ثابتة مثل Vercel
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

execSync('npx vite build --config vite.demo.config.ts', { stdio: 'inherit' });
const dir = 'dist-demo';
const html = fs.readFileSync(path.join(dir, 'src/demo/index.html'), 'utf8');
const read = (href) => fs.readFileSync(path.join(dir, href.replace(/^\//, '')), 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+)"/g)].map((m) => read(m[1])).join('\n');
const js = [...html.matchAll(/<script type="module"[^>]*src="(\/assets\/[^"]+)"/g)].map((m) => read(m[1])).join('\n');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
const title = 'فوكاش للتحويلات ونقاط البيع';
const body = (host) => `<style>html{direction:rtl}${css.replace(/<\/style/gi, '<\\/style')}</style>
<div id="root" dir="rtl" lang="ar"></div>
<script>window.__VOCACH_HOST='${host}';document.documentElement.setAttribute('dir','rtl');document.documentElement.setAttribute('lang','ar');</script>
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>
`;

const artifact = `<title>${title}</title>\n${fonts}\n${body('artifact')}`;
fs.writeFileSync(path.join(dir, 'vocach-demo.html'), artifact);

const web = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#0f766e">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>${title}</title>
${fonts}
</head>
<body>
${body('web')}</body>
</html>
`;
fs.rmSync('dist-web', { recursive: true, force: true });
fs.mkdirSync('dist-web');
fs.writeFileSync('dist-web/index.html', web);
fs.copyFileSync('public/favicon.svg', 'dist-web/favicon.svg');
console.log('demo:', (artifact.length / 1024 / 1024).toFixed(2), 'MB');
