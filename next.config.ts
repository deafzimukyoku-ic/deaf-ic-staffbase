import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    /* worktree (.claude/worktrees/<name>) から起動するとき turbopack の filesystem root
       が worktree dir になり node_modules junction (親リポジトリの node_modules 指し) が
       「root 外を指す symlink」と判定されて panic する。
       親リポジトリの実パスを root にすると worktree 自身もその配下で扱われ junction も
       root 内とみなされる。worktree でないとき (CWD = 親リポジトリ) は実害なし。 */
    root: path.resolve(process.cwd(), process.cwd().includes('.claude/worktrees') || process.cwd().includes('.claude\\worktrees') ? '../../..' : '.'),
  },
};

export default nextConfig;
