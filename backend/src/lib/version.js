// 当前版本号：以 yh-app.json 为准，读不到退回 package.json，都读不到是空串。只在启动时读一次
// 本地开发 yh-app.json 在仓库根；容器里是 /app/yh-app.json（Dockerfile 拷的）、工作目录 /app/backend
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function versionIn(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')).version
    return typeof v === 'string' ? v.trim() : ''
  } catch {
    return ''
  }
}

// 先按代码位置找（不受启动目录影响），再试工作目录
export function readVersion(dirs = [BACKEND, process.cwd()]) {
  const inDirs = (name) => dirs.flatMap((d) => [path.join(d, name), path.join(d, '..', name)])
  for (const file of [...inDirs('yh-app.json'), ...inDirs('package.json')]) {
    const v = versionIn(file)
    if (v) return v
  }
  return ''
}

export const VERSION = readVersion()
