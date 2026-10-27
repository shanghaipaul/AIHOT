# 本地开发与合并上游的工作流

> 这份文档只服务于你自己的 fork，**不要提交回上游仓库**（上游 CONTRIBUTING 说明：`AGENTS.md`、`CLAUDE.md`、依赖锁文件、二进制文件等不接受外部 PR 修改）。删掉这份文件也不影响任何功能。

## 1. 分支模型

| 分支 | 指向 | 作用 |
| --- | --- | --- |
| `upstream/main` | 官方仓库 KKKKhazix/AIHOT 的 main | 只读镜像，日常更新的来源 |
| `main`（本地） | 始终等于 `upstream/main` | 纯净镜像分支，只用来更新，不写任何自定义提交 |
| `custom/main` | 你的长期个性化分支 | 你所有自定义改动的落点（站名/品牌/信源/自研功能） |
| `feature/<topic>` | 从最新 `upstream/main` 切出 | 一次只做一个功能，做完合并回 `custom/main` |

为什么这样分：`main` 保持与上游逐字一致，任何时候都能用一条命令看清「我落后上游多少」；所有改动集中在 `custom/main` 和短命的功能分支上，上游更新并进来时冲突面被压到最小。

## 2. 远程与本地 git 配置

```
upstream  https://github.com/KKKKhazix/AIHOT.git     # 官方仓库（只读）
origin    https://github.com/shanghaipaul/AIHOT.git  # 你的 fork（推送目标，2026-10-27 已建好）
```

你的 fork 网页地址：<https://github.com/shanghaipaul/AIHOT>

分支跟踪是拆开的：`custom/main` 的 **pull 走 upstream**（`git pull` = 拉上游并变基），
**push 走 origin**（`remote.pushDefault=origin`），所以 `git push` 不会误推到官方仓库。

已经写进本仓库 `.git/config` 的行为（只影响这个仓库）：

- `fetch.prune = true`：拉取时自动清理上游已删除的远程分支引用
- `rerere.enabled = true` + `rerere.autoupdate = true`：同一个冲突第二次遇到时自动复用上次的解法（反复同步上游时非常省事）
- `merge.conflictstyle = zdiff3`：冲突标记里额外显示「双方共同祖先」的内容
- `push.default = simple`：避免误推错分支

## 3. 日常：新增一个功能

```bash
cd /Volumes/ORICO/github/AIHOT

# 1) 先把本地镜像分支同步到最新上游
git checkout main
git pull --ff-only upstream main

# 2) 从最新上游切一个功能分支
git checkout -b feature/<功能名> upstream/main

# 3) 开发、提交（提交信息见第 5 节）
git add -A && git commit -m "feat(<scope>): <一句话说明>"

# 4) 合并回你的长期分支
git checkout custom/main
git merge --no-ff feature/<功能名>

# 5) 推送（前提：origin 已指向你的 fork）
git push origin custom/main
git push origin feature/<功能名>   # 想留档 / 开 PR 时再推
```

## 4. 定期：同步上游更新

```bash
cd /Volumes/ORICO/github/AIHOT
git fetch upstream --prune

# 看一下上游有多少新提交
git log --oneline custom/main..upstream/main

# 方式 A（推荐，只有你一个人用这个分支）：把上游改动变基到你的提交之上，历史干净
git checkout custom/main
git rebase upstream/main
git push --force-with-lease origin custom/main

# 方式 B（分支上已有别人协作 / 你不想改写已推送的历史）：用合并
git checkout custom/main
git merge upstream/main
git push origin custom/main
```

变基遇到冲突：`git rebase` 停下来 → 改文件 → `git add <文件>` → `git rebase --continue`；想放弃：`git rebase --abort`。
因为开了 `rerere`，同一个冲突在第二次同步上游时会自动按你上次的解法合上。

## 5. 提交信息规范

上游用 Conventional Commits，合并回上游时保持一致最好：

```
feat(<scope>): 新功能
fix(<scope>): 修 bug
docs(<scope>): 只改文档
refactor(<scope>): 不改变行为的重构
chore(<scope>): 构建 / 依赖 / 杂项
```

`<scope>` 用改动的区域，例如 `sources`（信源）、`prompts`（提示词）、`web`（前端）、`alerts`（告警）。

上游还要求：**一次 PR 解决一个清楚的问题**，不夹带无关重构，也**不要夹带 `package-lock.json` 的改动**（除非确实升级了依赖）。

## 6. 改动落在哪里（冲突面最小的写法）

上游 `AGENTS.md` 已经划出了三个「属于使用者」的扩展点，自定义改动尽量只落在这三处：

| 目录 | 放什么 | 冲突风险 |
| --- | --- | --- |
| `industry/` | 行业知识：`taxonomy.ts`（分类标签）、`topics.json`（主题）、`sources.json`（示范信源）、`prompts/`（提示词原文）、`selection.ts`（入选门槛） | 低 |
| `site/` | 这个站自己的东西：`site.ts`（站名文案）、`models.ts`（每一步的模型）、`brand/`（品牌与 Logo）、`pages/`（条款页）、`public/`（根目录固定文件）、`changelog.json`（更新日志） | 低 |
| `modules/` | 只服务于你这个站的功能，做成独立模块（模块自己的表放它的 `migrations/`） | 低 |
| `packages/` `apps/` `scripts/` `docs/` `database/` | 引擎核心：抓取、评分、聚簇、热度、公开读取层、API、前端框架、共享迁移 | **高** |

上游原话：「通常不需要改 `apps/` 和 `packages/`」——绝大多数需求用 `site/` + `industry/` + `modules/` 就能满足。

> **最关键的一条**：框架**从不 import 你的模块**，它只读 `site/modules/{index,server,web}.ts` 三份清单。你把功能放进独立模块目录、在这三份清单里登记一行，就能把与上游的冲突面压到最小。清单之外的目录一律别动。详见第 10 节。

再加三条硬规矩，能把冲突概率再降一档：

1. **不改上游的提示词原文与评分门槛**。要改就复制成你自己的版本放进 `industry/` 或 `modules/`，避免每次同步上游都要解同一个文件的冲突。
2. **不提交 `.env`、密钥、Cookie、生产数据**（上游明确禁止，也别提交 `.data/`）。
3. **数据库迁移只加不改**。已发布的迁移文件不要动，修正写进新文件；新迁移只放一条允许在线执行的语句，本地可用 `node scripts/check-migrations.ts --base main` 自查。

## 7. 加功能时必须守住的上游规则

这几条来自仓库 `AGENTS.md`，直接决定你的实现方式：

- 所有公开出口都从 `packages/backend/src/publication/` 这一个读取层读；新增公开出口（RSS、API、Agent Markdown、MCP 等）也从这里走，别在别处另开一条读数据库的路。
- 前端 `apps/web` 只通过 HTTP 读 `apps/api`；数据库、模型调用、密钥只留在后端。
- 读者打开页面不触发模型调用；模型只在 worker 的任务里调用。
- 付费请求要走 `providers/receipts.ts` 的回执和预算熔断，不要绕开。
- 安全阀默认关闭，开发时保持 `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_*_ENABLED`、`INDEXNOW_SUBMIT_ENABLED` 全部为关。
- 信源默认只展示摘要和原文链接（`site_fulltext` 关），只有来源明确允许时才开全文。
- 停用或替换一个功能时，同一个改动里删掉它的代码、测试、文档和存下的状态（库表与列、定时任务、settings、环境变量、`.env.example` 里的项），别留半截。
- 新增环境变量要同步写进 `.env.example`；改了站点配置字段的含义，示例配置跟着改，保证老站升级后行为不变。
- 迁移放 `database/migrations/`（只属于某个模块的表放该模块的 `migrations/`），按完整文件名排序执行；**从 `0055` 起每个文件只放一条允许在线执行的语句**，索引用 `CONCURRENTLY IF NOT EXISTS`，大批数据回填不进发布迁移。
- 改了 `industry/taxonomy.ts`（分类）后，`tests/` 里用到示例行业分类、标签、公司的测试数据要一起换成你行业的对应项——这是最容易在同步上游时打架的地方。
- 不要用 AIHOT 的名字和 Logo。

## 8. 冲突处理备忘

- `git status` 看是哪个文件冲突；冲突文件里 `<<<<<<<` / `=======` / `>>>>>>>` 三段分别是「你的版本」「上游版本」「共同祖先」。
- `git diff --ours <文件>` / `git diff --theirs <文件>` 分别看两边；`git checkout --ours <文件>` / `--theirs` 直接取一边。
- 解决完 `git add <文件>`，再按当前操作提示 `git rebase --continue` / `git merge --continue`。
- 不想解了：`git rebase --abort` / `git merge --abort` 回到操作前状态。

## 9. 本地验证（改完代码跑一遍再提交）

```bash
npm install                       # 首次
npm run typecheck                # 类型检查
DATABASE_URL=postgres://127.0.0.1:5432/<名字>_test npm test   # 库名必须以 _test 或 _ci 结尾
npm run test:standalone          # 不依赖数据库的独立测试
npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts
node scripts/smoke.ts --base http://localhost:3000   # 站点跑起来之后
```

开发时把采集、模型调用、外部推送关掉，别拿生产库或真实付费服务做测试：

```bash
cp .env.example .env    # 按需修改
# .env 里把 COLLECT_ENABLED=false、MODEL_CALLS_ENABLED=false
```


## 10. 功能落点速查（按改动类型）

| 你要做的事 | 落在哪里 | 要不要动核心代码 |
| --- | --- | --- |
| 换行业 / 换信源 / 换分类 / 换提示词 / 换门槛 | `industry/`：`taxonomy.ts`、`topics.json`、`sources.json`、`prompts/*.md`、`selection.ts` | 否 |
| 换站名 / 品牌 / 条款页 / 每步用的模型 | `site/`：`site.ts`、`models.ts`、`brand/`、`pages/`、`public/`、`changelog.json` | 否 |
| **加一个只有你这个站要的功能** | 新建 `modules/<name>/`，在 `site/modules/{index,server,web}.ts` 三份清单登记 | 否 |
| 新增信源类型 | 后台「信源」新建即可；需要新 kind 时用模块的 `sourceKinds` 插口 | 否 |
| 改评分维度 | 只改 `industry/prompts/selection-score.md` + `industry/selection.ts`，用 `scripts/eval-selection.ts` 在样本上校准 | 否（别动 `editorial/` 代码） |
| 加一个输出渠道（日报/告警/RSS/MCP） | 模块 `server.ts` 的 `http` / `schedules` / `queues` / `on.articleChanged` 插口；公开内容仍从 `packages/backend/src/publication/` 读 | 否 |
| 加一个前端页面 | 模块 `module.ts` 的 `pages` + `web.tsx`；导航入口还要同步 `site/site.ts` 的 `NAV` 与手机底栏 | 否（但 `site/site.ts` 是冲突热点，见第 11 节） |
| 真要改引擎核心 | `packages/backend/src/`、`apps/`、`database/migrations/` | 是 —— 每次同步上游都要重新解冲突 |

### 新建一个模块的标准动作

```bash
mkdir -p modules/<name>/{migrations,tests}     # 模块自己的表放 migrations/，自己的测试放 tests/
cd modules/<name> && npm init -w @aihot/<name> # 模块是一个 npm 包
```

然后写 4 个文件 + 登记 3 处：

```
modules/<name>/module.ts    地址（路由）
modules/<name>/server.ts    后端插口：http / schedules / queues / on.articleChanged / sourceKinds
modules/<name>/web.tsx      网页插口：页面与组件
modules/<name>/migrations/  只属于这个模块的表（与引擎迁移按完整文件名混排执行）

site/modules/index.ts        登记模块地址
site/modules/server.ts       登记模块后端
site/modules/web.ts          登记模块网页

site/package.json            加模块依赖
Dockerfile                   加一行 COPY modules/<name>/package.json modules/<name>/
```

原则：**框架里插口不够用时，在框架里加一个通用插口，而不是把这个功能写进框架**（上游 `docs/architecture.md` 原话）。

## 11. 冲突热点与避让清单

按上游 161 次提交统计，改动最频繁的地方（也就是最容易和你撞车的地方）：

| 位置 | 上游改动次数 | 风险 |
| --- | --- | --- |
| `packages/backend/src/`（core：`content/`、`sources/`、`editorial/`、`events/`、`publication/`） | 877 | **高** |
| `apps/web/app/`（含 `routes/item.tsx` 28KB、`story.tsx` 22KB、`hot.tsx` 17KB 三个大文件） | 585 | **高** |
| `apps/api/src/` | 111 | 中 |
| `apps/web/tests/` | 60 | 中 |
| `packages/contracts/src/` | 50 | 中 |
| `docs/deploy.md` | 33 | 中 |
| `docs/sources.md` / `docs/customize.md` | 18 | 中 |
| `.env.example` | 11 | 中 |
| `site/site.ts`、`packages/contracts/src/site.ts` | 10 | 中 |
| `packages/backend/src/modules.ts` | 13 | 中 |
| `package-lock.json` | 18 | **高** |

明确要避开的地方：

- `AGENTS.md`、`CLAUDE.md`、`CONTRIBUTING.md`、`SECURITY.md`、`.agents/`、`.claude/` —— 上游不收外部 PR 对这些文件的修改。
- `package-lock.json` —— 除非你确实升级了依赖，否则不要让它出现在你的提交里（重装依赖常常会顺手改它，注意每次 `git add` 前看一眼 diff）。
- 不要在 `packages/backend/src/` 顶层塞新的业务文件 —— 放在 `modules/<name>/` 里。
- 不要改 `tests/architecture.test.ts` 的边界规则来「让检查通过」。
- `.env.example` 只在你的分组段落**追加**，不要重排已有行。

## 12. 会被 CI 卡住的几条硬检查

`tests/architecture.test.ts` 会强制下面这些，改之前先知道，能少走弯路：

- **前端只走 HTTP**：不能在前端直连数据库、不能出现模型调用或密钥。
- **公开路由只读 `publication/`**：新增公开出口必须在 `packages/backend/src/publication/` 实现。
- **表的写权限归属**：`publications` / `facts` / `deliveries` 等表只能由归属目录写，模块写自己的表。
- **北京时间只在 `packages/contracts/src/time.ts` 换算**，别处不要自己算时区。
- **每个库表列都必须被代码读到**，加了没人用的列会在检查里暴露。
- **`.env.example` 与代码读取必须一一对应**：代码里读到的配置项必须在模板里，模板里的必须被代码读到 —— 所以加配置项要同时改 `.env.example` **和** `packages/backend/src/config.ts`。
- **新增公开字段的完整链路**：`packages/contracts/` 加类型 → `database/migrations/` 加列 → `packages/backend/src/publication/` 实现读取 → 前端经 HTTP 取。

数据库迁移的检查（PR 也会跑）：

```bash
node scripts/check-migrations.ts --base main   # 新迁移自查
```

规则：已发布的迁移不改；新迁移编号 ≥ `0055`；**一个文件只放一条允许在线执行的语句**；索引用 `CREATE INDEX CONCURRENTLY IF NOT EXISTS` 单独成文件；加 CHECK / 外键先 `NOT VALID` 再另建迁移验证；不做大批量 UPDATE / DELETE。

测试方面没有独立的 fixtures 目录：标注样本是 `industry/*.example.jsonl`，本地私有的样本放 `.data/gold.jsonl`（不进 Git）。

## 13. 本机工具箱（已装好，直接用）

都在 `/Volumes/ORICO/github/aihot-tools/` 下，不进版本库，只有你这台机器有（详细说明见该目录的 `README.md`）：

| 工具 | 作用 | 用法 |
| --- | --- | --- |
| `aihot-sync.sh` | 一键把上游更新并进 `custom/main` | `./aihot-sync.sh` ／ `./aihot-sync.sh check`（只看不动手） |
| `aihot-new-feature.py` | 一键生成一个新功能模块的完整骨架 | `python3 aihot-new-feature.py <模块名> [页面标题]` |
| `analyze-upstream.py` | 统计上游更新频率（提交/周、PR、贡献者、提交空档） | `python3 analyze-upstream.py [--days 30] [--json out.json]` |
| `.git/hooks/pre-commit` | 护栏：拦密钥/`.data/`，提醒锁文件与引擎核心改动 | 提交时自动跑 |
| `.git/hooks/commit-msg` | 护栏：提交信息必须是 Conventional Commits | 提交时自动跑，`WIP: xxx` 可跳过 |

上一次上游更新频率的快照：`/Volumes/ORICO/github/aihot-tools/upstream-frequency-2026-10-27.md`（含原始 JSON）。

护栏行为（已实测）：

- 提交 `.env` / 密钥 / `.data/` → **直接拦下**
- 提交信息不是 `feat(scope): xxx` 这类格式 → **直接拦下**（`Merge` / `Revert` / `WIP:` 放行）
- 动了 `package-lock.json` → 提醒（不拦）
- 动了 `packages/backend/src`、`apps/web/app`、`apps/api/src`、`packages/contracts/src` → 提醒这是上游冲突高发区（不拦）

注意：本仓库的 `core.hooksPath` 被设成了 `.git/hooks`（覆盖了全局的临时钩子目录），否则上面两个护栏不会被 git 调用。

`aihot-sync.sh` 的执行顺序：

```
git fetch upstream --prune
-> 打印落后的提交与涉及的文件
-> git checkout custom/main && git rebase upstream/main
-> 有冲突就停下并列出冲突文件（解决后 git add + git rebase --continue）
-> node scripts/check-migrations.ts --base main   (上游自带的迁移安全检查)
-> npm run typecheck                              (类型检查)
-> 提示 git push --force-with-lease origin custom/main
```

注意 rebase 冲突的一个细节：`rerere` 会把上次同类的解法**自动填好并 stage**，但 rebase 仍然会停一次，需要你 `git rebase --continue` 走完 —— 这不是出错。

## 14. 速查

```bash
git checkout main && git pull --ff-only upstream main   # 同步镜像
git fetch upstream --prune                              # 只看上游有没有更新
git log --oneline custom/main..upstream/main           # 我落后了哪些提交
git log --oneline upstream/main..custom/main           # 我比上游多了哪些提交
git rebase upstream/main                               # 把上游更新并进来（当前分支上执行）
git push --force-with-lease origin custom/main         # 变基后安全强推
```

## 15. 版本与发布（tag）

打 tag 的规矩：**在 `custom/main` 上打**，名字 `v<主>.<次>.<改>`。这个版本号是本站自己的，
和上游无关 —— 上游到现在还没有任何 tag，所以名字由我们定。

```bash
# 1) 确认工作区干净、当前在 custom/main
git checkout custom/main && git status --porcelain

# 2) 打带说明的 tag（说明写这一版改了什么，相对上一版）
git tag -a v0.2.0 -m "AI日报 v0.2.0 ……" custom/main

# 3) 推到自己的 fork
git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push origin v0.2.0

# 4) 写说明时看这一版相对上游多了什么
git log --oneline upstream/main..custom/main
```

已有的版本：

| tag | 提交 | 内容 |
| --- | --- | --- |
| `v0.1.0` | 3ecbb26 | 第一个版本：站名改成「AI日报」、daily-push 模块（出刊才推）、模型统一切到 MiniMax M3.1 Flash、信源 18 → 46 |

GitHub 上的 Release 页面要 `gh auth login`（本机还没登录）。没登录时 tag 已经在仓库里了，
Release 页面可以之后在网页上补；站内的更新日志条目写在 `site/changelog.json`。
