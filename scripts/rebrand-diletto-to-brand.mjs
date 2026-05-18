/* rebrand: diletto- → brand- (識別子のみ。色値や見た目は完全に維持)

   対象ディレクトリ: app/**, components/**, lib/**
   対象拡張子: .ts / .tsx / .css

   置換ルール (順序が重要):
     1. diletto-gray-light → brand-gray-light (gray より前)
     2. diletto-(ink|beige|blue|gold|green|red|gray|bg) → brand-$1
     3. --color-diletto- → --color-brand-
     4. --shadow-diletto-sm → --shadow-brand-sm
     5. --shadow-diletto → --shadow-brand
     6. shadow-diletto-sm → shadow-brand-sm (Tailwind 用クラス)
     7. shadow-diletto → shadow-brand
     8. Diletto(Header|Footer) → Brand$1 (コンポーネント名と import 識別子)
     9. /DilettoHeader → /BrandHeader (import path 部分)
    10. /DilettoFooter → /BrandFooter

   保持 (置換しない):
     - diletto-shift-maker, diletto-staffbase, diletto-new-staffbase (参照元アプリ名)
     - docs/, CLAUDE.md, seed/, scripts/, .next/, node_modules/, .git/ (履歴ドキュメント / build キャッシュ)

   コメント内の単独 "diletto" (色トークンでない記述) は手動判断のため自動置換しない。
   置換後の grep で残量を確認する */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const INCLUDE_DIRS = ['app', 'components', 'lib'];
const INCLUDE_EXT = new Set(['.ts', '.tsx', '.css']);

const REPLACEMENTS = [
  /* 順序固定。先に長いマッチを処理する */
  { from: /diletto-gray-light/g,   to: 'brand-gray-light' },
  { from: /diletto-ink/g,          to: 'brand-ink' },
  { from: /diletto-beige/g,        to: 'brand-beige' },
  { from: /diletto-blue/g,         to: 'brand-blue' },
  { from: /diletto-gold/g,         to: 'brand-gold' },
  { from: /diletto-green/g,        to: 'brand-green' },
  { from: /diletto-red/g,          to: 'brand-red' },
  { from: /diletto-gray/g,         to: 'brand-gray' },
  { from: /diletto-bg/g,           to: 'brand-bg' },
  /* CSS 変数: 接頭辞だけ置換 */
  { from: /--color-diletto-/g,     to: '--color-brand-' },
  { from: /--shadow-diletto-sm/g,  to: '--shadow-brand-sm' },
  { from: /--shadow-diletto/g,     to: '--shadow-brand' },
  /* Tailwind shadow クラス */
  { from: /shadow-diletto-sm/g,    to: 'shadow-brand-sm' },
  { from: /shadow-diletto/g,       to: 'shadow-brand' },
  /* コンポーネント名 + import 識別子 */
  { from: /DilettoHeader/g,        to: 'BrandHeader' },
  { from: /DilettoFooter/g,        to: 'BrandFooter' },
];

function walk(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
        stack.push(p);
      } else if (INCLUDE_EXT.has(path.extname(e.name))) {
        out.push(p);
      }
    }
  }
  return out;
}

const files = INCLUDE_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
console.log(`scanning ${files.length} files...`);

let totalReplacements = 0;
let changedFiles = 0;
const changedList = [];

for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  let content = original;
  let fileCount = 0;
  for (const { from, to } of REPLACEMENTS) {
    content = content.replace(from, (m) => { fileCount += 1; return to; });
  }
  if (fileCount > 0 && content !== original) {
    fs.writeFileSync(file, content);
    changedFiles += 1;
    totalReplacements += fileCount;
    changedList.push({ file: path.relative(ROOT, file), count: fileCount });
  }
}

console.log(`\n--- summary ---`);
console.log(`files scanned: ${files.length}`);
console.log(`files changed: ${changedFiles}`);
console.log(`total replacements: ${totalReplacements}`);
console.log(`\n--- top 20 changed files (by count) ---`);
changedList.sort((a, b) => b.count - a.count).slice(0, 20)
  .forEach(({ file, count }) => console.log(`  ${count.toString().padStart(4)}  ${file}`));
