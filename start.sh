#!/usr/bin/env bash
# 本地一键启动：后端 3020 + 前端 5193；首次运行自动初始化
set -e
cd "$(dirname "$0")"

if ! mysqladmin ping -uroot -proot --silent 2>/dev/null; then
  echo "⚠️  连不上本地 MySQL（root/root），请先启动 MySQL"; exit 1
fi
mysql -uroot -proot -e "CREATE DATABASE IF NOT EXISTS personal_finance DEFAULT CHARACTER SET utf8mb4" 2>/dev/null

[ -d backend/node_modules ] || (cd backend && npm install)
[ -d frontend/node_modules ] || (cd frontend && npm install)
[ -f backend/.env ] || cp backend/.env.example backend/.env
if ! mysql -uroot -proot personal_finance -e "select 1 from Category limit 1" >/dev/null 2>&1; then
  echo "▶ 首次初始化数据库"
  (cd backend && npx prisma db push && npm run seed)
fi

for port in 3020 5193; do
  pid=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "⚠️  端口 $port 已被占用（PID $pid：$(ps -o command= -p $pid | cut -c1-80)）"
    echo "   如果是上次没关的个人财务，执行 kill $pid 后重试"; exit 1
  fi
done

(cd backend && npm run dev) & BACK=$!
(cd frontend && npm run dev) & FRONT=$!
trap "kill $BACK $FRONT 2>/dev/null" EXIT
echo "✅ 打开 http://localhost:5193"
wait
