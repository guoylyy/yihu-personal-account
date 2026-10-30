# 个人财务：单容器镜像，前端打包产物由后端托管
# 部署在以虎 One 上：yh 按 yh-app.json 构建并启动；数据库连接串 DATABASE_URL 由平台注入
FROM node:20-alpine AS web
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY backend/prisma ./prisma
RUN npx prisma generate
COPY backend/src ./src
# 版本号从清单读（lib/version.js），/api/health 返回给前端显示
COPY yh-app.json /app/yh-app.json
COPY --from=web /src/frontend/dist /app/frontend/dist
ENV NODE_ENV=production PORT=3020
EXPOSE 3020
# 表结构用 db push 对齐（不带 --accept-data-loss：会丢数据的改动直接失败，平台自动回滚）；seed 可重复执行：只补科目（个人数据文件 backend/data 不进镜像）
CMD ["sh", "-c", "npx prisma db push --skip-generate && node prisma/seed.js && node src/index.js"]
