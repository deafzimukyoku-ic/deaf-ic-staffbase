import type { NextConfig } from "next";

/* turbopack.root をプロジェクトルート (この next.config.ts が置かれているディレクトリ) に
   絶対パスで明示固定する。次の 2 つの誤検出を同時に防ぐ:

   1. 旧設定 root: '..'  → Projects/ ディレクトリ (deaf-ic の親、複数の別 Next.js
      プロジェクトが並ぶ) を root にし、ai-skill-exchange / diletto-new-staffbase 等
      隣接プロジェクトを workspace 内とみなしていた。
   2. 未指定 (デフォルト) → Next.js 16 が package.json を走査して自動検出する際、
      deaf-ic/diletto-staffbase/ や deaf-ic/diletto-shift-maker/ といったサブ
      ディレクトリの別 Next.js プロジェクトの package.json を拾って root に
      しまうことがあり、その結果 staffbase 側のキャッシュ/ファイルを参照する事故が
      発生した (実害確認済)。

   import.meta.dirname (Node 20.11+) で next.config.ts の絶対パスを取得し、deaf-ic
   ディレクトリだけを root に固定。サブの diletto-shift-maker / diletto-staffbase は
   tsconfig.json の exclude にも入っており、turbopack / TS どちらの解決でも安全に切り離せる。 */
const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
