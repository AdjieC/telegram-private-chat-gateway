#!/usr/bin/env node
/**
 * 将 core.hooksPath 指向仓库内 .githooks，使 pre-commit 自动构建 dist。
 * 在非 git 目录或无权写 git config 时静默跳过（例如部分 CI 解压场景）。
 */
import { execSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hooksDir = join(root, '.githooks');
const preCommit = join(hooksDir, 'pre-commit');

if (!existsSync(join(root, '.git'))) {
  process.exit(0);
}

try {
  if (existsSync(preCommit)) {
    try {
      chmodSync(preCommit, 0o755);
    } catch {
      // Windows 等环境可能无法 chmod，hooks 仍可通过 sh 执行
    }
  }
  execSync('git config core.hooksPath .githooks', {
    cwd: root,
    stdio: 'ignore',
  });
} catch {
  // 忽略：只读文件系统或无 git 写权限
}
