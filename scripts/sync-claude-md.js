/**
 * CLAUDE.md 自动同步脚本
 * 扫描 worker.js 中的函数定义和配置项，更新 CLAUDE.md 中的关键函数索引表
 *
 * 用法：node scripts/sync-claude-md.js
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WORKER_JS = join(ROOT, 'worker.js');
const UTILS_JS = join(ROOT, 'src', 'utils.js');
const CLAUDE_MD = join(ROOT, 'CLAUDE.md');

// --- 1. 扫描函数定义 ---

function extractFunctions(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const rawLines = content.split('\n');
  const functions = [];

  // 只匹配顶层定义（行首无缩进）
  // 支持：function xxx(...)、async function xxx(...)、export function xxx(...)
  const funcPattern = /^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_]\w*)\s*\(/;
  // const xxx = (...) => 或 const xxx = async (...) =>
  const constFuncPattern = /^const\s+([a-zA-Z_]\w*)\s*=\s*(?:async\s*)?\(/;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    // 跳过有缩进的行（局部变量/内部函数）
    if (rawLine.startsWith('  ') || rawLine.startsWith('\t')) continue;
    const line = rawLine.trim();

    let match = funcPattern.exec(line);
    if (!match) match = constFuncPattern.exec(line);
    if (match) {
      functions.push({ name: match[1], line: i + 1 });
    }
  }
  return functions;
}

function extractConfigKeys(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const keys = [];
  // 匹配 CONFIG 对象中的键
  const configMatch = content.match(/const\s+CONFIG\s*=\s*\{([\s\S]*?)\n\};/);
  if (configMatch) {
    const body = configMatch[1];
    const keyPattern = /^\s*(\w+)\s*:/gm;
    let m;
    while ((m = keyPattern.exec(body)) !== null) {
      keys.push(m[1]);
    }
  }
  return keys;
}

function extractKvKeys(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const keys = new Set();

  // 1. 匹配字面量字符串键：TOPIC_MAP.get("key") 或 TOPIC_MAP.get('key')
  const literalPattern = /TOPIC_MAP\.(?:get|put|delete)\(\s*[`'"]([^`'"]+)[`'"]/g;
  let m;
  while ((m = literalPattern.exec(content)) !== null) {
    keys.add(m[1]);
  }

  // 2. 匹配模板字符串键：TOPIC_MAP.get(`user:${userId}`) → 提取为 `user:{userId}`
  const templatePattern = /TOPIC_MAP\.(?:get|put|delete)\(\s*`([^`]+)`/g;
  while ((m = templatePattern.exec(content)) !== null) {
    // 将模板变量 ${varName} 归一化为 {id}，消除不同变量名的差异
    const key = m[1].replace(/\$\{[^}]+\}/g, '{id}');
    keys.add(key);
  }

  // 3. 对所有键名做最终归一化，确保 `banned:${userId}` 和 `banned:{id}` 合并
  const normalized = new Set();
  for (const key of keys) {
    normalized.add(key.replace(/\$\{[^}]+\}/g, '{id}'));
  }

  return [...normalized].sort();
}

// --- 2. 生成 Markdown 表格 ---

function generateFunctionTable(workerFunctions, utilsFunctions) {
  const lines = [];
  lines.push('## 关键函数索引（自动生成）');
  lines.push('');
  lines.push('> 由 `scripts/sync-claude-md.js` 自动生成，请勿手动修改。');
  lines.push('');
  lines.push('### worker.js 主函数');
  lines.push('');
  lines.push('| 函数 | 行号 | 职责 |');
  lines.push('|------|------|------|');

  for (const fn of workerFunctions) {
    const comment = getFunctionComment(WORKER_JS, fn.line);
    lines.push(`| \`${fn.name}\` | L${fn.line} | ${comment} |`);
  }

  if (utilsFunctions.length > 0) {
    lines.push('');
    lines.push('### src/utils.js 纯函数');
    lines.push('');
    lines.push('| 函数 | 行号 | 职责 |');
    lines.push('|------|------|------|');

    for (const fn of utilsFunctions) {
      const comment = getFunctionComment(UTILS_JS, fn.line);
      lines.push(`| \`${fn.name}\` | L${fn.line} | ${comment} |`);
    }
  }

  return lines.join('\n');
}

function getFunctionComment(filePath, funcLine) {
  const lines = readFileSync(filePath, 'utf8').split('\n');
  // 向上查找 JSDoc 注释
  let comment = '';
  for (let i = funcLine - 2; i >= Math.max(0, funcLine - 10); i--) {
    const line = lines[i].trim();
    if (line.startsWith('*') && !line.startsWith('*/')) {
      const cleaned = line.replace(/^\*\s*/, '').trim();
      if (cleaned && !cleaned.startsWith('@')) {
        comment = cleaned;
        break;
      }
    }
    if (line.startsWith('/**')) break;
  }
  if (!comment) {
    // 尝试单行注释
    for (let i = funcLine - 2; i >= Math.max(0, funcLine - 3); i--) {
      const line = lines[i].trim();
      if (line.startsWith('//')) {
        comment = line.replace(/^\/\/\s*/, '').trim();
        break;
      }
    }
  }
  return comment || '—';
}

function generateConfigTable(configKeys) {
  const lines = [];
  lines.push('');
  lines.push('## CONFIG 配置项（自动生成）');
  lines.push('');
  lines.push('> 由 `scripts/sync-claude-md.js` 自动生成，对应 worker.js 中的 CONFIG 对象。');
  lines.push('');
  lines.push('| 配置项 |');
  lines.push('|--------|');
  for (const key of configKeys) {
    lines.push(`| \`${key}\` |`);
  }
  return lines.join('\n');
}

function generateKvKeysTable(kvKeys) {
  const lines = [];
  lines.push('');
  lines.push('## KV 键名约定（自动生成）');
  lines.push('');
  lines.push('> 由 `scripts/sync-claude-md.js` 自动扫描 `env.TOPIC_MAP` 调用提取。');
  lines.push('');
  lines.push('| 键名模式 |');
  lines.push('|----------|');
  for (const key of kvKeys) {
    lines.push(`| \`${key}\` |`);
  }
  return lines.join('\n');
}

// --- 3. 更新 CLAUDE.md ---

function updateSection(content, sectionTitle, newContent) {
  // 查找自动生成区块的标记
  const startMarker = `<!-- AUTO-GENERATED START: ${sectionTitle} -->`;
  const endMarker = `<!-- AUTO-GENERATED END: ${sectionTitle} -->`;

  if (content.includes(startMarker) && content.includes(endMarker)) {
    // 替换已有区块
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker) + endMarker.length;
    return content.slice(0, startIdx) + startMarker + '\n\n' + newContent + '\n\n' + endMarker + content.slice(endIdx);
  } else {
    // 追加到文件末尾
    if (!content.endsWith('\n')) content += '\n';
    return content + '\n' + startMarker + '\n\n' + newContent + '\n\n' + endMarker + '\n';
  }
}

// --- 主流程 ---

function main() {
  console.log('🔍 扫描项目结构...');

  const workerFunctions = extractFunctions(WORKER_JS);
  const utilsFunctions = fileExists(UTILS_JS) ? extractFunctions(UTILS_JS) : [];
  const configKeys = extractConfigKeys(WORKER_JS);
  const kvKeys = extractKvKeys(WORKER_JS);

  console.log(`  worker.js: ${workerFunctions.length} 个函数`);
  console.log(`  src/utils.js: ${utilsFunctions.length} 个函数`);
  console.log(`  CONFIG: ${configKeys.length} 个配置项`);
  console.log(`  KV 键名: ${kvKeys.length} 个`);

  let claudeMd = readFileSync(CLAUDE_MD, 'utf8');

  // 更新关键函数索引
  const funcTable = generateFunctionTable(workerFunctions, utilsFunctions);
  claudeMd = updateSection(claudeMd, 'functions', funcTable);

  // 更新 CONFIG 配置项
  const configTable = generateConfigTable(configKeys);
  claudeMd = updateSection(claudeMd, 'config', configTable);

  // 更新 KV 键名约定
  const kvTable = generateKvKeysTable(kvKeys);
  claudeMd = updateSection(claudeMd, 'kv-keys', kvTable);

  // 更新时间戳
  const now = new Date().toISOString().split('T')[0];
  claudeMd = claudeMd.replace(
    /生成时间：.*?(?=\n|$)/,
    `生成时间：${now}`
  );
  if (!claudeMd.includes('生成时间：')) {
    claudeMd = claudeMd.replace(
      /> 由 `scripts\/sync-claude-md\.js` 自动生成，请勿手动修改。/,
      `> 由 \`scripts/sync-claude-md.js\` 自动生成，最后同步：${now}。`
    );
  }

  writeFileSync(CLAUDE_MD, claudeMd, 'utf8');
  console.log('✅ CLAUDE.md 已更新');
}

function fileExists(path) {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

main();
