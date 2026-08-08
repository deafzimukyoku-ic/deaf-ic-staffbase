/* Node の module 解決フック。`@/lib/...` の path alias（tsconfig の paths）を
   プロジェクトルートからの実ファイルに解決する。

   目的: 検証スクリプトから **本番と同じ .ts をそのまま import** できるようにすること。
   ロジックを .mjs へ書き写すと「写し間違い」を検証できないので、実コードを直接動かす。

   使い方:
     node --experimental-strip-types --import ./scripts/_register-alias.mjs scripts/xxx.ts */
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');

export async function resolve(specifier, context, next) {
  if (!specifier.startsWith('@/')) return next(specifier, context);
  const base = path.join(ROOT, specifier.slice(2));
  /* 拡張子省略に対応（.ts → .tsx → /index.ts の順で探す） */
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) {
      return next(pathToFileURL(candidate).href, context);
    }
  }
  return next(specifier, context);
}
