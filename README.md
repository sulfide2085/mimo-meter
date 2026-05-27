# Mimo Meter - Token 用量仪表盘

小米 Mimo API 的 Token 用量监控仪表盘，支持多账号管理，提供每日用量明细、套餐信息和额度统计。

## 项目架构

```
mimo-meter/
├── index.html          # 前端页面
├── app.js              # 前端逻辑（API 调用、UI 交互）
├── style.css           # 样式文件
├── server.py           # 本地 Python 后端（Flask）
├── cookie.txt          # 本地开发用 cookie 存储
├── requirements.txt    # Python 依赖
├── run.bat             # Windows 启动脚本
├── test_api.py         # API 测试脚本
├── dist/               # 前端部署产物（Cloudflare Pages 部署此目录）
└── worker/             # Cloudflare Worker（生产环境后端）
    ├── src/index.js    # Worker 主逻辑
    └── wrangler.toml   # Worker 配置
```

### 两种运行模式

| 模式 | 前端 | 后端 | Cookie 存储 |
|------|------|------|-------------|
| 本地开发 | 直接访问 `server.py` | `server.py` (Flask, 端口 5000) | `cookie.txt` 文件 |
| 生产环境 | Cloudflare Pages (`dist/`) | Cloudflare Worker | Cloudflare KV + Secrets |

前端通过 `app.js` 中的 `API_BASE` 自动切换：
- `localhost` / `127.0.0.1` → 调用本地 `server.py`（端口 5000）
- 其他域名 → 调用 `https://mimo-meter.sulfide2085.workers.dev`

**注意：** 生产环境中前端文件直接部署到 Cloudflare Pages，修改前端源文件后需要重新部署 Pages。

## Cookie 说明

访问小米 Mimo API 需要以下 Cookie：

| Cookie 名称 | 必填 | 说明 |
|-------------|------|------|
| `api-platform_serviceToken` | 是 | API 认证令牌 |
| `userId` | 是 | 用户 ID |
| `api-platform_ph` | 否 | 每日明细接口必需的查询参数，缺失时该功能不可用 |

### 获取 Cookie

1. 登录 [platform.xiaomimimo.com](https://platform.xiaomimimo.com)
2. 打开浏览器开发者工具（F12）→ Network 面板
3. 刷新页面，找到任意 API 请求
4. 在请求头中复制完整的 `Cookie` 字段值
5. 使用网页底部「账号管理」面板导入：
   - **一键粘贴**：复制完整 Cookie 字符串后点击「一键粘贴」自动解析填入各字段
   - **逐个粘贴**：点击各输入框旁的「粘贴」按钮，从剪贴板读取并填入对应字段
   - **手动填写**：将对应值粘贴到各输入框即可

Cookie 字符串中的双引号会被自动去除，无需手动处理。

## 额度用量展示

额度用量区域根据 API 返回的 `name` 字段自动识别并展示：

| name 字段 | 显示名称 | 说明 |
|-----------|----------|------|
| `plan_total_token` | 套餐总量 | 套餐内 Token 额度 |
| `compensation_total_token` | 补偿积分 | 赠送的补偿额度（部分账号有） |
| `month_total_token` | 本月 | 当月已使用量 |

当账号存在补偿积分（`compensation_total_token` 的 `limit > 0`）时，「本月」行的额度上限会显示为套餐总量与补偿积分之和，百分比基于该总和重新计算。例如套餐总量 38000M、补偿积分 11350M，则「本月」显示为 `462.42M / 49350.65M (0.94%)`。

## 更新 Cookie（关键操作）

Cookie 会过期，过期后网页显示 `API error: code 401`。需要按以下步骤更新：

### 方法一：通过网页管理面板（推荐）

1. 打开网页，展开底部「账号管理」
2. 输入管理密码（`ADMIN_TOKEN`）并验证
3. 复制完整的 Cookie 字符串，点击「一键粘贴」自动解析，或点击各字段旁的「粘贴」按钮逐个粘贴
4. 点击「添加」保存

### 账号管理

- **改名**：点击账号右侧「改名」按钮，输入新名称即可更新，无需重新填写 Cookie
- **删除**：点击「删除」按钮移除账号

### 方法二：通过命令行更新本地开发环境

编辑 `cookie.txt`，更新 JSON 中对应账号的 `cookies` 字段。

### 方法三：通过命令行更新生产环境（Cloudflare Worker）

```bash
cd worker

# 1. 更新 KV 存储（主要数据源）
npx wrangler kv key get "accounts" --binding ACCOUNTS --remote
# 将输出的 JSON 修改后写回：
npx wrangler kv key put "accounts" '<新的 JSON>' --binding ACCOUNTS --remote

# 2. 更新 Secret（备用数据源，保持同步）
echo '<新的 JSON>' | npx wrangler secret put MIMO_COOKIES

# 3. 重新部署 Worker
npx wrangler deploy
```

**注意：** KV 和 Secret 都需要更新。Worker 优先从 KV 读取，KV 为空时回退到 Secret。

## 本地开发

```bash
# 安装依赖
pip install -r requirements.txt

# 启动服务器
python server.py
# 或使用 run.bat

# 访问 http://localhost:5000
```

## Cloudflare Worker 部署

```bash
cd worker

# 安装依赖
npm install

# 首次部署需要配置 Secrets
npx wrangler secret put MIMO_COOKIES    # 输入 cookie JSON
npx wrangler secret put ADMIN_TOKEN     # 输入管理密码

# 部署
npx wrangler deploy
```

### Worker 环境变量/Secrets

| 名称 | 类型 | 说明 |
|------|------|------|
| `ACCOUNTS` | KV Namespace | 账号数据主存储 |
| `MIMO_COOKIES` | Secret | Cookie JSON（KV 为空时的回退） |
| `ADMIN_TOKEN` | Secret | 管理面板密码（为空则不需要验证） |

## Cloudflare Pages 部署（前端）

前端部署到 Cloudflare Pages，项目名 `mimo-meter`，生产 URL：`https://mimo-meter.pages.dev/`

```bash
# 部署到 Pages 生产环境
npx wrangler pages deploy . --project-name=mimo-meter --branch=main
```

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/accounts` | GET | 获取账号列表 |
| `/api/accounts` | POST | 添加/更新账号 |
| `/api/accounts` | DELETE | 删除账号 |
| `/api/detail` | GET | 套餐详情 |
| `/api/usage` | GET | 额度用量 |
| `/api/daily` | POST | 每日明细（支持 `year`/`month` 参数） |
| `/api/all` | GET | 聚合所有数据 |

所有数据接口支持 `?account=N` 参数选择账号。

## 常见问题

### API error: code 401

**原因：** Cookie 已过期

**解决：** 按照「更新 Cookie」章节重新获取并更新 Cookie。

### 如何确认 Cookie 是否有效

```bash
# 本地测试
curl -s http://localhost:5000/api/detail | head -c 200

# 生产环境测试
curl -s https://mimo-meter.sulfide2085.workers.dev/api/detail | head -c 200
```

返回 `"code": 0` 表示有效，`"code": 401` 表示已过期。

### Worker 部署后不生效

确保同时更新了 KV 和 Secret，然后重新部署：
```bash
npx wrangler kv key put "accounts" '<JSON>' --binding ACCOUNTS --remote
npx wrangler deploy
```
