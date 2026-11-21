// Builds DriftClub.html: the whole game (HTML + CSS + every JS module) in ONE file
// that runs by double-clicking it — no server, no install.
// Browsers block <script type="module"> imports on file:// pages, so this script
// wraps each module in its own function scope and links them in dependency order.
// Usage (only needed after editing the source): node build-standalone.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'public');
const ENTRY = path.join(ROOT, 'js', 'main.js');
const OUT = path.join(__dirname, 'DriftClub.html');

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*['"](.+?)['"];?\s*$/gm;
const EXPORT_RE = /^export\s+(?:const|let|var|(?:async\s+)?function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;

const mods = new Map(); // abs path -> {id, deps, code}
const order = [];
function load(file, stack = []) {
  if (mods.has(file)) return;
  if (stack.includes(file)) throw new Error('Import cycle: ' + [...stack, file].map((f) => path.relative(ROOT, f)).join(' -> '));
  const src = fs.readFileSync(file, 'utf8');
  const deps = [];
  let body = src.replace(IMPORT_RE, (m, names, spec) => {
    const dep = path.resolve(path.dirname(file), spec);
    if (!fs.existsSync(dep)) throw new Error(`Missing import "${spec}" in ${path.relative(ROOT, file)}`);
    deps.push(dep);
    const binds = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': ')).join(', ');
    return `const { ${binds} } = __mod[${JSON.stringify(path.relative(ROOT, dep))}];`;
  });
  if (/^\s*(import|export)\b/m.test(body.replace(EXPORT_RE, ''))) {
    const bad = body.replace(EXPORT_RE, '').match(/^\s*(import|export)\b.*$/m)[0];
    throw new Error(`Unsupported import/export form in ${path.relative(ROOT, file)}: ${bad}`);
  }
  const names = [];
  body = body.replace(EXPORT_RE, (m, name) => { names.push(name); return m.replace(/^export\s+/, ''); });
  mods.set(file, null);
  for (const d of deps) load(d, [...stack, file]);
  mods.set(file, { id: path.relative(ROOT, file), code: body, names });
  order.push(file);
}
load(ENTRY);

let js = '"use strict";\nconst __mod = Object.create(null);\n';
for (const f of order) {
  const m = mods.get(f);
  js += `\n// ===== ${m.id} =====\n__mod[${JSON.stringify(m.id)}] = (function () {\n${m.code}\nreturn { ${m.names.join(', ')} };\n})();\n`;
}

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
// PWA bits (manifest, home-screen icon) need a web server; the standalone file skips them
html = html.replace(/^\s*<link rel="(?:manifest|apple-touch-icon)"[^>]*>\n?/gm, '');
html = html.replace(/<link rel="stylesheet" href="css\/style.css">/, () => `<style>\n${css}\n</style>`);
const safeJs = js.replace(/<\/script/gi, '<\\/script');
html = html.replace(/<script type="module" src="js\/main.js"><\/script>/, () => `<script>\n${safeJs}\n</script>`);
if (html.includes('src="js/') || html.includes('href="css/')) throw new Error('Unreplaced external reference in index.html');
fs.writeFileSync(OUT, html);
console.log(`Built ${path.basename(OUT)}: ${order.length} modules, ${(html.length / 1024).toFixed(0)} KB`);
