# 部署与运维

## 目录结构

```
seo2api/
├── server.js
├── src/  public/  scripts/
└── data/                 ← 全部状态在这里
    ├── seo2api.db        SQLite 主库
    ├── seo2api.db-wal    WAL 日志
    └── backups/          自动与手动备份
```

**备份 = 复制 `data/`。迁移 = 把 `data/` 拷到新机器。**

## 三种部署方式

### 1. Docker（推荐）

```bash
export SEO2API_ADMIN_TOKEN=$(head -c 24 /dev/urandom | base64)
docker compose up -d
docker compose logs -f
```

数据在 `./data`，容器重建不丢。

### 2. systemd

```bash
sudo useradd -r -s /bin/false seo2api
sudo cp -r . /opt/seo2api
sudo chown -R seo2api:seo2api /opt/seo2api
sudo cp deploy/seo2api.service /etc/systemd/system/
sudo systemctl enable --now seo2api
```

### 3. 直接跑

```bash
nohup node server.js > seo2api.log 2>&1 &
```

只适合试用。生产环境用前两种。

## Nginx 反代

```nginx
server {
    listen 443 ssl http2;
    server_name seo.example.com;

    ssl_certificate     /etc/letsencrypt/live/seo.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/seo.example.com/privkey.pem;

    # 分析接口可能要跑十几秒，超时给足
    proxy_read_timeout 120s;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        # 必须传，否则限流会把所有请求算成一个 IP
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
    }
}
```

配好之后设 `SEO2API_PUBLIC_URL=https://seo.example.com`，报告链接和 llms.txt 才会正确。

## 备份策略

### 手动

```bash
node scripts/seo2api.js backup
node scripts/seo2api.js backup /mnt/backup   # 指定目录
```

### 定时

```cron
# 每天 3:00 备份，保留 30 天
0 3 * * * cd /opt/seo2api && /usr/bin/node scripts/seo2api.js backup && find /opt/seo2api/data/backups -name '*.db' -mtime +30 -delete
```

服务自身也会每天自动备份一次（启动后每隔 24 小时）。

### 备份为什么安全

用的是 SQLite 的 `VACUUM INTO`，它在事务层面生成一致性快照。对比 `cp seo2api.db`：直接复制在写入过程中可能抓到"主库已更新但 WAL 未合并"的中间状态，恢复后可能丢数据甚至损坏。

### 恢复

```bash
node scripts/seo2api.js restore data/backups/seo2api-2026-01-01T03-00-00.db
```

恢复流程：
1. 把备份复制到临时目录，先跑完整性校验（`PRAGMA integrity_check`）
2. 校验失败 → 中止，**原数据不动**
3. 校验通过 → 当前库另存为 `.before-restore-<时间戳>`，清掉 WAL/SHM，写入新库
4. 再次校验，失败则提示用 `.before-restore` 回滚

## 升级

```bash
node scripts/seo2api.js backup    # 先备份
git pull
node scripts/seo2api.js doctor    # 自检
# 重启服务
```

数据库 schema 有 `user_version` 管理，启动时自动迁移。迁移是幂等的，回滚只需恢复备份。

## 监控

```bash
curl http://localhost:8787/health
```

```json
{"ok":true,"status":"healthy","version":"1.1.0","uptimeSeconds":3600,
 "database":{"integrity":"ok","bytes":110592,"audits":42}}
```

Prometheus 抓 `/metrics`（启用鉴权时只允许 admin token 访问）：

```
seo2api_http_requests_total 1234
seo2api_http_responses_total{status="2xx"} 1200
seo2api_analysis_duration_ms_avg 2841
seo2api_uptime_seconds 3600
```

## 容量规划

单个报告（含 84 条检查）约 30–60KB。10 万条报告约 4GB。

```sql
-- 清理 90 天前的报告
DELETE FROM audits WHERE created_at < strftime('%s','now','-90 days') * 1000;
VACUUM;
```

用量日志自动保留 7 天（每天清理一次）。

## 常见问题

**Q：抓取总是 403？**
目标站点可能挡了 UA。改 `fetch.userAgent` 成你自己的标识，或确认站点不封数据中心 IP。

**Q：分析很慢（>10 秒）？**
设 `fetch.fetchAuxiliary: false` 可省 2–3 秒（跳过 robots/sitemap/llms.txt）。或者检查目标站点的 TTFB。

**Q：能抓内网吗？**
默认不行，这是安全设计。测试场景可设 `SEO2API_ALLOW_PRIVATE=1`，但生产环境别开。

**Q：支持多实例吗？**
当前是单实例设计（SQLite + 内存限流）。多实例需要把限流换成 Redis、数据换成 Postgres。对绝大多数场景，单实例足够——分析是 IO 密集而非 CPU 密集。
