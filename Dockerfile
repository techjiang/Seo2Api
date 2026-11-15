# 多阶段构建：最终镜像不含任何构建工具，只有运行时
FROM node:24-alpine AS base
WORKDIR /app

# 本项目零第三方依赖，所以没有 npm install 这一步
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# 数据目录单独声明为卷，容器重建不丢数据
RUN mkdir -p /app/data && addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
ENV SEO2API_DATA_DIR=/app/data \
    SEO2API_HOST=0.0.0.0 \
    SEO2API_PORT=8787 \
    NODE_ENV=production

EXPOSE 8787
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
