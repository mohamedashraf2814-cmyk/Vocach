// يبني نسخة العرض ويدمجها في ملف HTML واحد قابل للنشر كرابط (Artifact)
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
const out = `<title>فوكاش للتحويلات ونقاط البيع</title>
${fonts}
<style>html{direction:rtl}${css.replace(/<\/style/gi, '<\\/style')}</style>
<div id="root" dir="rtl" lang="ar"></div>
<script>document.documentElement.setAttribute('dir','rtl');document.documentElement.setAttribute('lang','ar');</script>
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
fs.writeFileSync(path.join(dir, 'vocach-demo.html'), out);
console.log('demo:', (out.length / 1024 / 1024).toFixed(2), 'MB');
