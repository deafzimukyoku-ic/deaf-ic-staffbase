import type { NextConfig } from "next";

/* turbopack.root をプロジェクトルート (この next.config.ts が置かれているディレクトリ) に
   絶対パスで明示固定する。次の 2 つの誤検出を防ぐ:

   1. 旧設定 root: '..' のように Projects/ 親ディレクトリ (deaf-ic の親、複数の別 Next.js
      プロジェクトが並ぶ) を root にすると、隣接プロジェクトを workspace 内とみなして
      しまう。
   2. 未指定 (デフォルト) → Next.js 16 が package.json を走査して自動検出する際、
      サブディレクトリの別 Next.js プロジェクトの package.json を拾って root に
      してしまう可能性がある (過去 deaf-ic/diletto-staffbase/ で実害発生 → 当該ディレクトリは
      2026-05-19 に統合完了に伴い削除済)。

   import.meta.dirname (Node 20.11+) で next.config.ts の絶対パスを取得し、deaf-ic
   ディレクトリだけを root に固定する。 */
const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
