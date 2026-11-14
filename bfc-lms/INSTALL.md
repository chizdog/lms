# BFC LMS 安装与部署指南

But First, Coffee — Learning Management System
React + TypeScript + Tailwind 前端 · Node.js + Express 后端 · **PostgreSQL** 数据库

本指南覆盖：环境准备 → 数据库初始化 → 应用配置 → 构建 → 启动（开发 / 生产）→ 验证 → 运维（备份 / 停止 / 重置）→ **部署到 Render（云）** → 可选反向代理。

> 推荐部署形态：
> - **本地 / 内网**：单端口 Node.js 生产模式。Express 在 `:4000` 同时托管构建好的前端 SPA 与 `/api`，无需 Apache / IIS / PHP。PostgreSQL 独立运行（便携版或系统服务均可）。
> - **公网 / 云**：**Render**（托管 PostgreSQL + Web 服务），仓库根目录已附带 `render.yaml` 蓝图，见 §14。

---

## 1. 目录结构约定

本指南假设工作区结构如下（`bfc-lms` 与 `.runtime` 同级，`render.yaml` 在仓库根）：

```
<workspace>/                      # Git 仓库根
├─ render.yaml                    # Render 蓝图（PostgreSQL + Web 服务）
├─ .runtime/                      # 便携运行时（可选，本仓库已附带；不入库）
│  ├─ node-v24.18.0-win-x64/      # 便携 Node.js
│  ├─ postgresql-16.4/            # 便携 PostgreSQL 16（bin/ 含 initdb/pg_ctl/psql/pg_dump）
│  ├─ pg-data/                    # PostgreSQL 数据目录（集群）
│  └─ pg.log                      # PostgreSQL 日志
└─ bfc-lms/
   ├─ client/                     # React 前端（Vite）
   ├─ server/                     # Express 后端（TypeScript）
   ├─ database/                   # schema.sql / seed.ts / backup.ts / assets/
   │  └─ assets/                  # 示例素材：sample-lesson.mp4 + thumbnails/*.jpg（入库）
   ├─ storage/                    # 上传 / 证书 / 导出 / 备份（不入库）
   ├─ start-production.cmd        # 生产一键启动（自动拉起便携 PostgreSQL）
   ├─ stop-production.cmd         # 生产停止
   └─ INSTALL.md                  # 本指南
```

除特别说明外，**应用命令均在 `bfc-lms/` 或其子目录执行**；便携运行时路径用 `..\.runtime\...` 表示。

> `storage/` 与 `.runtime/` 已被 `.gitignore` 排除。课程缩略图等**必需**素材放在入库的 `database/assets/`，`db:seed` 会自动把它们复制到 `storage/`，因此全新克隆（含 Render）无需手工补素材。

---

## 2. 环境要求

| 组件 | 要求 | 说明 |
| --- | --- | --- |
| 操作系统 | Windows 10/11（本指南）；Linux/macOS 同理 | 脚本为 Windows `.cmd` |
| Node.js | **20 LTS / 22 / 24**（实测 24.18.0） | Vite 6 与 sharp 需 ≥18.17 |
| 数据库 | **PostgreSQL 14+**（推荐 16，实测 16.4） | 不再使用 MySQL / MariaDB |
| 端口 | `4000`（应用）、`5432`（PostgreSQL） | 开发模式前端另用 `5173` |
| 磁盘 | ≥ 2 GB | 含依赖、便携运行时与示例素材 |

检查 Node：`node -v`。若使用便携 Node，先把它加入 PATH（见 §3）。

---

## 3. 方式 A：使用便携运行时（本仓库已附带，免安装）

适合不想在系统里装 Node / PostgreSQL 的场景。

### 3.1 启用便携 Node（当前终端会话）

Git Bash：
```bash
export PATH="<workspace>/.runtime/node-v24.18.0-win-x64:$PATH"
node -v   # 应输出 v24.18.0
```
CMD / PowerShell：
```bat
set "PATH=<workspace>\.runtime\node-v24.18.0-win-x64;%PATH%"
```
> `start-production.cmd` 会自动优先使用便携 Node，无需手动设置。

### 3.2 初始化 PostgreSQL 数据目录（**仅当 `pg-data` 为空**）

已附带初始化好的 `pg-data` 时**跳过**本步。全新环境执行：
```bat
..\.runtime\postgresql-16.4\bin\initdb.exe -D ..\.runtime\pg-data -U bfc_app -A scram-sha-256 -W -E UTF8
```
- `-U bfc_app`：把 **bfc_app** 设为集群超级用户（便携开发图省事；生产请改用 §5 的最小权限角色）。
- `-W`：交互提示设置 bfc_app 密码。**请设为与 `server/.env` 的 `DB_PASSWORD` 一致**（开发默认 `BfcLmsDev2026Secret`）。
- `-A scram-sha-256`：密码认证方式；`-E UTF8`：数据库编码。

### 3.3 启动 PostgreSQL

```bat
..\.runtime\postgresql-16.4\bin\pg_ctl.exe -D ..\.runtime\pg-data -l ..\.runtime\pg.log -o "-p 5432 -c listen_addresses=127.0.0.1" start
```
看到日志 `database system is ready to accept connections` 即就绪。
`start-production.cmd` 会在检测到 `:5432` 未监听时自动拉起并轮询等待就绪。

停止（优雅，勿强杀 postgres 进程）：
```bat
..\.runtime\postgresql-16.4\bin\pg_ctl.exe -D ..\.runtime\pg-data stop
```

---

## 4. 方式 B：系统安装 Node + PostgreSQL

1. 安装 Node.js 20/22/24（nodejs.org），确认 `node -v`、`npm -v`。
2. 安装 PostgreSQL 16（Installer 或 ZIP），以系统服务运行，端口 `5432`。
3. 记住超级用户（通常 `postgres`）密码；应用账号 / 库在 §5 创建。
4. 无需 `.runtime`；后续命令直接用系统 `node` / `npm` / `psql` / `pg_dump`。

---

## 5. 创建数据库与应用账号

`schema.sql` **不会**自动建库 / 建用户，需先手动创建。

**便携 PostgreSQL**（§3.2 已用 `-U bfc_app` 初始化，bfc_app 即超级用户）——只需建库：
```bat
..\.runtime\postgresql-16.4\bin\createdb.exe -h 127.0.0.1 -p 5432 -U bfc_app bfc_lms
```
或进入 psql 执行 `CREATE DATABASE bfc_lms OWNER bfc_app;`

**系统 / 生产 PostgreSQL**——用超级用户（如 `postgres`）连接后创建最小权限角色与库：
```sql
CREATE ROLE bfc_app LOGIN PASSWORD '请改用强密码';
CREATE DATABASE bfc_lms OWNER bfc_app;
-- 可选：收紧权限，仅授予应用所需
-- REVOKE ALL ON DATABASE bfc_lms FROM PUBLIC;
```
> 密码请同步到 `server/.env` 的 `DB_PASSWORD`。生产不要用超级用户跑应用，也不要暴露 `5432` 到公网。

---

## 6. 配置后端环境变量 `server/.env`

复制 / 编辑 `server/.env`（已附带一份开发默认值；模板见 `server/.env.example`）：

```ini
NODE_ENV=development
PORT=4000

DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=bfc_app
DB_PASSWORD=BfcLmsDev2026Secret
DB_NAME=bfc_lms
DB_CONNECTION_LIMIT=15

SESSION_COOKIE_NAME=bfc_session
SESSION_TTL_HOURS=12
CLIENT_ORIGIN=http://localhost:5173

STORAGE_DIR=../storage
MAX_UPLOAD_MB=200
```

| 变量 | 作用 |
| --- | --- |
| `NODE_ENV` | `development` / `production`。生产由启动脚本 / Render 覆盖为 `production` |
| `PORT` | 应用端口，默认 `4000`（Render 会注入自己的 `PORT`） |
| `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` | 离散连接参数，需与 §5 一致。**PostgreSQL 默认端口 5432** |
| `DATABASE_URL` | （可选）整串连接 URL，**优先级高于离散 `DB_*`**。Render 托管 Postgres 用此项，如 `postgres://user:pass@host:5432/db` |
| `DB_SSL` | 是否启用 TLS 连接数据库。本地 `false`/省略；Render 托管设 `true` |
| `DB_SSL_REJECT_UNAUTHORIZED` | 校验数据库证书。默认 `true`；Render 托管证书不在公共 CA  bundle 时设 `false`（见 §14） |
| `DB_SSL_CA` | （可选）自定义 CA 证书 PEM，用于严格校验托管数据库 |
| `CLIENT_ORIGIN` | 开发模式前端源（CORS 白名单）；生产单端口同源可不改；Render 设为公网 URL |
| `STORAGE_DIR` | 上传 / 证书 / 导出 / 备份根目录 |
| `COOKIE_SECURE` | 会话 Cookie 是否加 `Secure`。**默认生产=true**；纯 HTTP 部署设 `false`，上 HTTPS / Render 后设 `true` |

> 连接方式二选一：本地用离散 `DB_*`；Render 用 `DATABASE_URL`（此时 `DB_USER/PASSWORD/NAME` 可省略）。

---

## 7. 安装依赖

```bat
cd server
npm install
cd ..\client
npm install
cd ..
```

> 数据库脚本（`db:schema` / `db:seed` / `db:backup`）通过 **server 的 npm scripts** 运行（`tsx ../database/*.ts`），依赖从 `server/node_modules` 解析，无需额外配置。若你想直接在 `database/` 目录跑 `tsx`，需让 `database/node_modules` 指向 `server/node_modules`（Windows 用目录联接 `mklink /J`，Linux/macOS 用 `ln -s`；`render.yaml` 的构建命令已自动处理）。

---

## 8. 初始化数据库与示例数据

在 `server/` 目录执行（脚本读取 `server/.env`）：

```bat
cd server
npm run db:schema     :: 应用 database/schema.sql（建表，PostgreSQL DDL）
npm run db:seed       :: 写入示例组织 / 员工 / 课程 / 测验 / 证书 + 生成素材
cd ..
```

- `db:schema` 会 **DROP 并重建** 所有表，仅用于初始化 / 重置。
- `db:seed` 生成示例素材（PDF / PNG / DOCX / PPTX / 证书）到 `storage/`，并**自动把 `database/assets/thumbnails/*.jpg` 复制到 `storage/uploads/thumbnails/`**（全新克隆 / Render 无需手工补缩略图）。
- 一键重置：`npm run db:reset`（= schema + seed）。
- （可选）`npx tsx ../database/prepare-assets.ts`：仅当你自带 **PNG** 缩略图放在 `storage/uploads/thumbnails/` 需要转成 JPG 时才跑；仓库已附带 JPG，通常不需要。

---

## 9. 构建（生产必需）

```bat
cd server
npm run build         :: tsc → server/dist
cd ..\client
npm run build         :: vite → client/dist
cd ..
```

产物：`server/dist/index.js` 与 `client/dist/index.html + assets/`。Express 生产模式会自动托管 `client/dist`。

---

## 10. 启动（本地）

### 10.1 生产模式（推荐，单端口）

**一键脚本**（自动拉起便携 PostgreSQL + 设置生产环境 + 启动 Node）：
```bat
start-production.cmd
```
或手动：
```bat
cd server
set NODE_ENV=production
set COOKIE_SECURE=false      :: 纯 HTTP 部署；上 HTTPS 后改 true
node dist/index.js
```
访问 **http://localhost:4000**（SPA 与 `/api` 同端口）。

停止：
```bat
stop-production.cmd
```
> 该脚本只停 `:4000` 的 Node 进程，**保留 PostgreSQL**（强杀 postgres 可能损坏数据）。如需停库，用脚本末尾打印的 `pg_ctl ... stop` 优雅关闭。

### 10.2 开发模式（前后端分离，热更新）

两个终端：
```bat
:: 终端 1 — 后端 :4000
cd server
npm run dev

:: 终端 2 — 前端 :5173
cd client
npm run dev
```
访问 **http://localhost:5173**（Vite 代理 `/api` 到 `:4000`）。

---

## 11. 验证清单

| 检查 | 命令 / 操作 | 期望 |
| --- | --- | --- |
| 健康 | `curl http://localhost:4000/api/health` | `{"status":"ok",...}` |
| SPA | 浏览器开 `http://localhost:4000/` | 登录页渲染 |
| 深链 | 开 `http://localhost:4000/courses` | 200，前端路由回退正常 |
| 登录 | 用 §12 账号登录 | 进入对应角色仪表盘 |
| 数据 | 仪表盘 KPI / 图表 | 有真实示例数据 |
| 缩略图 | 课程目录 / 详情 | 课程封面图正常显示 |

---

## 12. 默认演示账号

统一密码：**`Bfc@2026`**（seed 写入，生产请务必修改）。

| 用户名 | 角色 | 范围 |
| --- | --- | --- |
| `superadmin` | Super Admin (IT) | 全部 |
| `ld.admin` | L&D Admin | 课程 / 培训 |
| `hr.admin` | HR Admin | 人员 / 合规 |
| `dept.admin` | Dept Admin / Trainer | 本部门 |
| `employee` | Employee / Learner | 仅本人 |

---

## 13. 运维（本地）

```bat
cd server
npm run db:backup     :: 逻辑备份（pg_dump）→ storage/（含时间戳 .sql）
npm run db:reset      :: 重置 schema + seed（清空数据，慎用）
```
- 备份使用 `pg_dump`（自动定位便携 `postgresql-*/bin/pg_dump.exe`，或 `PG_DUMP_PATH` / 系统 PATH）。
- 上传 / 证书 / 导出文件在 `storage/`，备份时请一并拷贝。
- 建议用 Windows 任务计划程序定期调用 `db:backup`。

---

## 14. 部署到 Render（云，托管 PostgreSQL）

仓库根目录的 `render.yaml` 是 **Render Blueprint**：一次创建托管 PostgreSQL + Web 服务。

### 14.1 前置

1. 把整个仓库（含 `render.yaml`、`bfc-lms/`）push 到 GitHub / GitLab。
   - 确认 `.gitignore` 已排除 `.runtime/`、`storage/`、`node_modules/`、`.env`；**保留** `database/assets/`（缩略图 + 示例视频）。
2. 注册 Render 账号并授权该 Git 仓库。

### 14.2 用 Blueprint 部署

1. Render 控制台 → **New +** → **Blueprint**。
2. 选择本仓库；Render 读取根目录 `render.yaml`，预览将创建的资源：
   - `bfc-lms-db`：托管 PostgreSQL 16（free 计划）。
   - `bfc-lms`：Node Web 服务（free 计划，`rootDir: bfc-lms`）。
3. 按提示填写 `CLIENT_ORIGIN`（`sync: false` 的变量）：先留空或填预估 URL，部署后再改成真实公网 URL（见 14.5）。
4. 确认创建。Render 自动执行构建命令：
   ```
   npm --prefix server ci && npm --prefix server run build &&
   npm --prefix client ci && npm --prefix client run build &&
   ln -sfn ../server/node_modules database/node_modules
   ```
   启动命令：`node server/dist/index.js`；健康检查：`/api/health`。

### 14.3 环境变量（render.yaml 已预置）

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 生产模式 |
| `NODE_VERSION` | `22` | Render 构建用 Node 版本 |
| `DATABASE_URL` | 来自 `bfc-lms-db.connectionString` | 托管 Postgres 连接串，自动注入 |
| `DB_SSL` | `true` | 托管 Postgres 需 TLS |
| `DB_SSL_REJECT_UNAUTHORIZED` | `false` | Render 托管证书不在公共 CA bundle；如需严格校验改设 `DB_SSL_CA` |
| `COOKIE_SECURE` | `true` | Render 终结 TLS，应用处于 HTTPS 之后 |
| `CLIENT_ORIGIN` | 部署后填公网 URL | 如 `https://bfc-lms.onrender.com`（多个用逗号分隔） |
| `STORAGE_DIR` | `/opt/render/project/src/bfc-lms/storage` | free 层为**临时**文件系统 |

### 14.4 首次初始化数据库（仅一次）

部署成功后，打开 Web 服务的 **Shell** 标签，执行：
```bash
cd server && npm run db:schema && npm run db:seed
```
这会建表并写入示例数据 + 生成素材 / 缩略图到 `STORAGE_DIR`。之后无需重复（重复会清空数据）。

### 14.5 部署后收尾

1. 把 `CLIENT_ORIGIN` 改为服务真实公网 URL（Render → 服务 → Environment），保存触发重启。
2. 访问 `https://<服务名>.onrender.com`，用 §12 账号登录验证。
3. **立即修改所有演示密码**（尤其 `superadmin`）。

### 14.6 持久化与免费层限制（重要）

- **free Web 层文件系统是临时的**：重新部署 / 重启后 `storage/` 里的上传、证书、备份会丢失；空闲还会休眠。
- 要持久化上传 / 证书：给 Web 服务挂 **Render Disk（付费）**，`mountPath: /var/data`，并把 `STORAGE_DIR` 改为 `/var/data`。`render.yaml` 末尾有注释掉的 `disk:` 块，取消注释并升级实例计划即可。
- **free 托管 Postgres** 有容量 / 期限限制（到期会暂停），生产请升级付费计划以获得持久化与自动备份。
- 数据库本身（托管 Postgres）独立于 Web 文件系统，Web 重启不丢库数据；丢的只是 `storage/` 文件。

### 14.7 不用 Blueprint 的手动部署

若不想用蓝图，可手动创建：
1. **New +** → **PostgreSQL**：记下 Internal/External 连接串。
2. **New +** → **Web Service**：选仓库，`Root Directory = bfc-lms`，Runtime = Node。
   - Build Command / Start Command 同 14.2。
   - Environment 按 14.3 逐项填写（`DATABASE_URL` 用第 1 步的连接串）。
3. 首次按 14.4 初始化，按 14.5 收尾。

---

## 15. 可选：反向代理 / 自定义域名（本地或自有服务器）

本系统后端是 **Node**，IIS / Apache / Nginx 不能直接执行它，只能做静态托管或反向代理。

- **反向代理（推荐用于需要 80/443 或域名的场景）**：把 `/` 与 `/api` 反代到 `http://127.0.0.1:4000`；Node 仍用 `start-production.cmd` 运行；PostgreSQL 独立。上 HTTPS 后设 `COOKIE_SECURE=true`。
  - IIS：URL Rewrite + Application Request Routing (ARR)。
  - Nginx：`proxy_pass http://127.0.0.1:4000;`（含 WebSocket 无需特殊配置，本系统用普通 HTTP）。
- **仅静态 + 反代 /api**：托管 `client/dist`，仅把 `/api` 反代到 Node；需自行处理 SPA 回退与 CORS。

> 无论哪种，**Node 进程与 PostgreSQL 都必须运行**；代理只是入口层。XAMPP 的 Apache/PHP 对本系统无用（后端是 Node，不是 PHP）。

---

## 16. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| `EADDRINUSE :4000` | 端口被占。停掉旧进程（`stop-production.cmd`）或改 `PORT` |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL 未启动。先按 §3.3 / §4 启动 |
| `password authentication failed for user "bfc_app"` | §5 密码与 `.env` 的 `DB_PASSWORD` 不一致 |
| `database "bfc_lms" does not exist` | 未执行 §5 建库 |
| `function sum(boolean) does not exist` | 旧版 MySQL 语法残留；确保用最新 `server/dist`（已改为 `SUM((...)::int)`） |
| Render 连库报 SSL / 证书错误 | 设 `DB_SSL=true` + `DB_SSL_REJECT_UNAUTHORIZED=false`，或提供 `DB_SSL_CA` |
| 登录后立刻跳回登录页 | Cookie 被 `Secure` 拦截：纯 HTTP 设 `COOKIE_SECURE=false`；Render/HTTPS 设 `true` |
| 缩略图不显示 | 漏跑 `db:seed`（会自动复制缩略图）；或 `STORAGE_DIR` 指向了空目录 |
| Render 重启后上传 / 证书丢失 | free 层临时文件系统；按 §14.6 挂 Disk 持久化 |

---

## 17. 安全与生产建议

- **修改所有演示密码**（§12），尤其 `superadmin`。
- 上 **HTTPS**（Render 自带 TLS；自有服务器用代理终结证书），并设 `COOKIE_SECURE=true`。
- 数据库账号用强密码、最小权限（不要超级用户跑应用）；不要暴露 `5432` 到公网。
- 定期 `db:backup`（pg_dump）并异地保存；`storage/` 一并备份；Render 用付费托管 Postgres 的自动备份。
- 生产用 `NODE_ENV=production`（错误详情对外隐藏）。
- 本地如需开机自启：用任务计划程序在登录时运行 `start-production.cmd`，或将 Node 注册为 Windows 服务（如 NSSM）。

---

_最后更新：2026-11-14 · 实测环境 Windows 11 / Node 24.18.0 / PostgreSQL 16.4 · 支持 Render 托管部署_