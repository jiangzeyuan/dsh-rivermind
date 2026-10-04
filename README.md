# RiverMind · 德扑训练场

基于 DeepSeek Harness 的德扑 Agent 项目：独立玩家、受限工具、可追溯决策，以及按玩家保存的长期记忆。

当前是第一个可运行里程碑：**你与 Iris 的双人无限注德扑训练桌**。先验证完整牌局和真实 DSH Agent，再扩展到六人桌与策略评估。

![DSH 中的 RiverMind 牌桌与决策复盘](docs/images/rivermind-dsh.jpg)

## 安装到已有的 DeepSeek Harness

需要 Node.js 22+ 和已经安装、配置好模型的 DeepSeek Harness。当前对照 DSH **0.2.0-rc.2** 开发；官方桌面安装包提供的 `dsh` 命令自带 pnpm，其他 CLI 安装方式还需确保 pnpm 可用。

### 本地源码：桌面版

1. 先打开一次 DeepSeek Harness，让它初始化 `desktop` profile，再**完全退出应用**（macOS 使用 Cmd+Q）。只关闭窗口不等于退出。
2. 在本项目目录执行：

```sh
npm ci
dsh plugin --profile desktop add .
```

`npm ci` 会通过 `prepare` 自动构建。`add .` 将当前项目链接到 `desktop` profile，并根据 `dsh.bundle` 注册配置层，无需先上传 GitHub。

3. 重新打开 DeepSeek Harness，在左侧选择 **RiverMind 德扑训练场**，点击 **开始第一手**。以后正常打开 DSH 就会载入，不需要运行 `npm run start:dsh`。

桌面版 CLI 明确要求应用已初始化且完全退出后才能管理 `desktop` profile。源码修改后运行 `npm run build`，再重启 DSH；请保留项目目录，本地安装指向它。

### 本地源码：Web 版

在项目目录执行：

```sh
npm ci
dsh plugin --profile web add .
dsh web
```

如果 Web 版已经运行，安装后重启该进程。`desktop` 和 `web` 是两个独立 profile，需要把插件安装到实际使用的那个。`web` 的上述安装、正常启动、认证接口及规则模式完整牌局已在独立 DSH_HOME 中验证；没有改动已有的桌面配置，也没有调用模型。桌面安装后的界面交互仍需在实际应用中确认。

插件默认使用 DSH 中已配置的模型，不另行保存 API Key。模型调用使用你的 DSH 账号或 API 配额。单次行动预算为 25 秒、最多 6 次工具调用；超时或提交失败会明确标记安全兜底。

### 卸载

桌面版完全退出后执行：

```sh
dsh plugin --profile desktop remove @rivermind/dsh-plugin
```

Web 版把 `desktop` 改为 `web`，然后重启对应 DSH。卸载不清理训练记忆。本地开发依赖若被包管理器清理，运行 `npm ci` 可恢复。

## 从 GitHub 安装（仓库发布后）

仓库计划名称是 `dsh-rivermind`，包名仍为 `@rivermind/dsh-plugin`；两者不必一致。当前尚未发布，以下命令中的 `YOUR_GITHUB_NAME` 和 `COMMIT_SHA` 都是占位符，不可原样执行。发布后的远程 GitHub 安装仍需单独验收。

### 推荐先下载源码并本地安装

```sh
git clone https://github.com/YOUR_GITHUB_NAME/dsh-rivermind.git
cd dsh-rivermind
npm ci
dsh plugin --profile desktop add .
```

桌面版按前述步骤先初始化并完全退出，安装后重新打开。Web 用户把 `desktop` 改为 `web`，再运行 `dsh web`。

### 直接从 GitHub 安装

```sh
dsh plugin --profile desktop add github:YOUR_GITHUB_NAME/dsh-rivermind#COMMIT_SHA
```

仓库包含源码，`prepare` 会构建入口。pnpm 10+ 可能默认拦截 Git 依赖的构建；若出现相关提示，按 DSH/pnpm 提示在对应 profile 的 `pnpm-workspace.yaml` 中合并该包的授权，再重试安装：

```yaml
allowBuilds:
  '@rivermind/dsh-plugin': true
```

保留文件中已有的设置；若提示使用不同的精确包 key，采用提示里的 key。构建授权表示允许该包执行安装脚本，建议固定到已核对的 commit。流程依据 [DSH 官方插件打包与安装教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。

### 预构建包

维护者可以执行 `npm pack` 生成 `rivermind-dsh-plugin-0.1.0.tgz`，并在未来的 GitHub Release 提供下载。构建产物、bundle 配置和文档会进入包，训练数据不会进入。下载后安装：

```sh
dsh plugin --profile desktop add ./rivermind-dsh-plugin-0.1.0.tgz
```

这一方式携带构建产物，用户不需要在本地编译 RiverMind。预构建包的离线安装和 Host／客户端入口加载检查已通过；当前尚无已发布的 Release。

## 插件市场与收录

上传 GitHub 不等于自动上架。仓库建议添加 `dsh-plugin` 和 `deepseek-harness` topics，方便生态发现；项目也已声明相应的 package keywords。

`dshmarket` 是社区市场。按它的 [提交插件说明](https://github.com/dsh-market/dsh-market#submit-your-plugin)，需要向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提收录 PR，目录接纳并更新后才会在该市场出现。其他社区市场可能使用 GitHub topics 自动扫描或其他规则，需分别确认。

目前 RiverMind 尚未提交收录申请，不承诺市场搜索或一键安装已可用。发布时应先验证直接安装，再申请收录。

## 开发时临时加载

保留原来的启动方式，方便开发：

```sh
npm ci
npm run start:dsh
```

这个脚本生成项目内的 `.data/rivermind.patch.yml`，再启动 Web profile 并通过 `--patch` 临时加载插件，不会把插件持久安装进 profile。默认端口为 3080；端口被占用时：

```sh
RIVERMIND_DSH_PORT=3081 npm run start:dsh
```

启动日志会给出带认证参数的本地地址，首次打开使用该地址。已把 RiverMind 安装到 `web` profile 的用户直接运行 `dsh web`，避免再用临时加载方式重复注册同一插件。

## 不调用模型的本地预览

    npm run dev

打开 http://127.0.0.1:4317 。该预览明确标注为**规则陪练**，用于验证 UI 和扑克规则，不会伪装成 DSH 模型对手。DSH 牌桌也可以在两手牌之间切换到此模式。

## 当前能力

- 双人牌桌：交替庄位、小盲 / 大盲、弃牌、过牌、跟注、加注、全下跑牌及摊牌结算。
- 后端校验行动者、手牌编号、状态版本与合法金额。加注金额表示当前下注轮的累计金额。
- 独立 Iris Agent：新建会话，不继承其他会话；没有文件、Shell、联网、子 Agent 等全局工具。
- 四个扑克工具：get_observation、recall_opponent、estimate_equity、submit_action。
- 决策时记录简短理由与记忆引用；手牌结束后开放当前手牌复盘。
- 长期保存公开对手统计：观察手数、弃牌手数、翻牌前主动入池手数、出现进攻行动的手数及证据手牌编号。
- 明确区分真实 DSH 决策、规则陪练决策和安全兜底。

规则陪练的牌力估算使用未知牌抽样，并假设随机对手范围，不能视为 GTO 求解器。当前未实现六人桌、CFR/RL、自主策略升级、完整历史复盘 UI 或中断牌局恢复。

## 数据

常规安装后的运行数据默认位于 `~/.dsh/data/rivermind/`；设置 `DSH_HOME` 时使用该目录下的 `data/rivermind/`，与启动时的工作目录无关。

`npm run start:dsh` 和本地预览仍使用项目内的 `.data/`，已被 Git 忽略。这两种位置的记忆独立，不会自动迁移。需要沿用开发时的记忆，可以在 DSH 完全退出后，将 `.data/` 中的下列四个数据文件复制到常规安装的数据目录；已有目标数据时先备份，不要复制启动覆盖层。

数据文件：

- iris-memory.json：Iris 对人类玩家的公开行为统计，原子替换写入，跨重启保留。
- memory-history.jsonl：带版本标识的记忆快照。
- hands.jsonl：公开手牌事件，不包含底牌或决策理由。
- reviews.jsonl：供人类复盘的已结束手牌视图与决策理由；不会作为 Agent 观察或记忆工具输入。

开发时另有 `.data/rivermind.patch.yml`，它是根据当前项目绝对路径生成的启动覆盖层，不属于训练记忆。

“重新开始训练”会重置筹码和牌局，保留 Iris 的长期统计记忆。不要把 .data/ 提交到仓库。

## 开发与验证

    npm run typecheck
    npm test
    npm run build

测试覆盖轮次、牌力比较、全下退款、短额全下、平分底池、底牌和复盘权限隔离、持久记忆幂等、DSH 工具限制及行动关联。另外用 300 手牌随机合法行动验证筹码守恒。

目录：

    src/core/       规则、牌力评估、观察视图与规则陪练
    src/host/       DSH 适配、牌局调度、持久记忆与本地预览服务
    src/client/     牌桌、操作区、记忆及复盘面板
    scripts/        构建与 DSH 启动覆盖层
    tests/          规则与 Agent 边界测试
    docs/           架构与后续开发方向

详细说明见 [文档导航](docs/README.md) 和 [v0.1 技术方案](docs/technical-design-v0.1.md)；[架构速查](docs/architecture.md) 保留为简版。
