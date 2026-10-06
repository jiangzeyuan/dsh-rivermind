# RiverMind · 德扑训练场

基于 DeepSeek Harness 的德扑 Agent 项目：独立玩家、受限工具、可追溯决策，以及按玩家保存的长期记忆。

当前为 v0.3：**你与 Iris 的双人无限注德扑训练桌**。支持同栏展示的 BB / 底池比例快捷下注、BB / 筹码双单位展示、小数 BB 输入、默认收起且可保存的 Iris 决策预算，以及条件画像、记忆引用状态、历史复盘和可重复的规则评估。

![v0.1 DSH 牌桌示例，新版增加条件画像和历史复盘](docs/images/rivermind-dsh.jpg)

版本更新见 [CHANGELOG](CHANGELOG.md)，完整方案见 [当前技术设计](docs/technical-design.md)，各版本取舍见 [设计演进](docs/design-evolution.md)。维护者的发布顺序与操作见 [发布指南](docs/publishing.md)。

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

插件默认使用 DSH 中已配置的模型，不另行保存 API Key。模型调用使用你的 DSH 账号或 API 配额。单次行动默认预算为 60 秒、最多 10 次工具调用，可在牌桌中调整并保存；超时或提交失败会明确标记安全兜底。

### 卸载

桌面版完全退出后执行：

```sh
dsh plugin --profile desktop remove @rivermind/dsh-plugin
```

Web 版把 `desktop` 改为 `web`，然后重启对应 DSH。卸载不清理训练记忆。本地开发依赖若被包管理器清理，运行 `npm ci` 可恢复。

## npm 按包名安装（发布后）

当前 v0.3 源码已完成，npm 包仍待正式发布；下面是发布并验收后的目标安装方式，现在不要将它当作已可用的命令。

```sh
dsh plugin --profile web add @rivermind/dsh-plugin@0.3.0
dsh web
```

桌面用户在应用初始化并完全退出后，把 `web` 改为 `desktop`，安装后重新打开。npm 包携带构建产物，使用者不需要下载源码或执行 `npm ci`。包名发布前仍需确认对应命名空间权限；最终名称及发布状态见 [发布指南](docs/publishing.md)。

## 从 GitHub 安装

源码仓库为 [jiangzeyuan/dsh-rivermind](https://github.com/jiangzeyuan/dsh-rivermind)，包名为 `@rivermind/dsh-plugin`。以下命令需要仓库的 `main` 分支已推送；远程 GitHub 安装流程仍需单独验收。

### 推荐先下载源码并本地安装

```sh
git clone https://github.com/jiangzeyuan/dsh-rivermind.git
cd dsh-rivermind
npm ci
dsh plugin --profile desktop add .
```

桌面版按前述步骤先初始化并完全退出，安装后重新打开。Web 用户把 `desktop` 改为 `web`，再运行 `dsh web`。

### 直接从 GitHub 安装

```sh
dsh plugin --profile desktop add github:jiangzeyuan/dsh-rivermind#main
```

仓库包含源码，`prepare` 会构建入口。pnpm 10+ 可能默认拦截 Git 依赖的构建；若出现相关提示，按 DSH/pnpm 提示在对应 profile 的 `pnpm-workspace.yaml` 中合并该包的授权，再重试安装：

```yaml
allowBuilds:
  '@rivermind/dsh-plugin': true
```

保留文件中已有的设置；若提示使用不同的精确包 key，采用提示里的 key。构建授权表示允许该包执行安装脚本。示例从 `main` 分支安装；需要固定版本时，将 `#main` 替换为 `#` 加已核对的完整提交哈希。流程依据 [DSH 官方插件打包与安装教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) 和 [pnpm Git 仓库来源说明](https://pnpm.io/package-sources#git-repository)。

### 预构建包

维护者可以执行 `npm pack` 生成 `rivermind-dsh-plugin-0.3.0.tgz`，并在未来的 GitHub Release 提供下载。构建产物、bundle 配置和文档会进入包，训练数据不会进入。下载后安装：

```sh
dsh plugin --profile desktop add ./rivermind-dsh-plugin-0.3.0.tgz
```

这一方式携带构建产物，用户不需要在本地编译 RiverMind。预构建包的离线安装和 Host／客户端入口加载检查已通过；当前尚无已发布的 Release；包检查见 `npm run release:check`。

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

## 下注与 Iris 设置

翻牌前直接显示 2、2.5、3、5、10 BB 和全下；翻牌后在同一栏优先展示底池比例与全下，固定 BB 金额同样可直接选取。窄窗口可横向滑动查看，折叠区“滑动选额”只保留滑块。BB 输入箭头按 0.5 BB 调整，筹码单位按 1 筹码调整，手动输入仍支持精确的小数 BB。跟注和下注确认按钮同时标出 BB 与筹码数；轮到你且能加注时才显示金额编辑区。按钮只选择金额，确认行动后才提交。金额表示**本轮累计投入**；底池比例按“跟注后再加注”计算。非法快捷金额会禁用。

金额输入可切换 BB / 筹码。例如盲注 10 / 20 时，输入 `2.35 BB` 等于 47 筹码；最小筹码单位仍为 1。滑动选择保留在折叠区域。

侧栏 **Iris 决策预算** 默认收起，摘要保留当前上限；展开后可在两手牌之间选择快速（25 秒 / 6 次）、标准（60 秒 / 10 次）、深入（120 秒 / 16 次）或自定义；点击 **保存 Iris 预算** 后生效，重启后保留。思考时限范围为 5～300 秒，工具上限为 1～32 次，包含最终的 `submit_action`。规则陪练不使用这些模型预算。

每次 DSH 行动主动提供最新公开统计摘要，条件详情仍按需检索。复盘区分摘要提供、详情读取与显式引用；没有引用不能证明长期记忆完全没影响，模型对范围或风格的说明也不能单独视为长期画像。

历史复盘中，Iris 的底牌在摊牌结算时展示；弃牌结束的牌局显示“未亮牌”，记录不包含其未公开底牌。思考时显示已经等待的时间；结束复盘显示该次使用的预算、工具尝试及失败原因。更多细节见 [当前技术设计](docs/technical-design.md)。

## 当前能力

- 双人牌桌：交替庄位、小盲 / 大盲、弃牌、过牌、跟注、加注、全下跑牌及摊牌结算。
- 后端校验行动者、手牌编号、状态版本与合法金额。加注金额表示当前下注轮的累计金额。
- 独立 Iris Agent：新建会话，不继承其他会话；没有文件、Shell、联网、子 Agent 等全局工具。
- 四个扑克工具：get_observation、recall_opponent、estimate_equity、submit_action；预算可调整、保存，并绑定到每次决策。
- BB 与底池比例快捷下注、BB / 筹码精确输入，后端继续校验合法金额。
- 决策时记录简短理由与记忆引用；手牌结束后开放历史复盘，支持逐步回放、记忆证据跳转与工具摘要。
- 长期保存公开对手统计与条件画像：按下注轮、位置、下注尺度记录实际回应次数，附样本量、近似区间及证据编号；兼容旧记忆文件。
- 统一记录未跟注退款，提供可争夺底池赔率、有效筹码和跟注后 SPR。
- 固定种子配对发牌，比较无记忆、累计统计和条件画像的规则策略收益；评估不调用模型。
- 明确区分真实 DSH 决策、规则陪练决策和安全兜底。

规则陪练的牌力估算使用未知牌抽样，并假设随机对手范围，不能视为 GTO 求解器。当前未实现六人桌、CFR/RL、自主策略升级、全量历史索引或中断牌局恢复。

## 数据

常规安装后的运行数据默认位于 `~/.dsh/data/rivermind/`；设置 `DSH_HOME` 时使用该目录下的 `data/rivermind/`，与启动时的工作目录无关。

`npm run start:dsh` 和本地预览仍使用项目内的 `.data/`，已被 Git 忽略。这两种位置的记忆独立，不会自动迁移。需要沿用开发时的记忆，可以在 DSH 完全退出后，将 `.data/` 中的下列四个数据文件复制到常规安装的数据目录；已有目标数据时先备份，不要复制启动覆盖层。

数据文件：

- iris-memory.json：schema v2，Iris 对人类玩家的累计统计与条件回应计数；兼容 v1，原子替换写入，跨重启保留。
- memory-history.jsonl：带版本标识的记忆快照。
- hands.jsonl：公开手牌事件，不包含底牌或决策理由。
- reviews.jsonl：已结束手牌视图、简短理由、工具摘要与更新前画像；供历史复盘，不作为 Agent 观察或记忆来源。

另有 `agent-settings.json` 保存 Iris 决策预算，按需迁移，不属于 Agent 记忆。开发时的 `.data/rivermind.patch.yml` 是根据当前项目绝对路径生成的启动覆盖层，不属于训练记忆。

“重新开始训练”会重置筹码和牌局，保留 Iris 的长期统计记忆。不要把 .data/ 提交到仓库。

## 双人记忆评估

在源码项目中执行：

```sh
npm run eval:heads-up -- --pairs=50 --seeds=7,17,29,43,71 --trials=100
```

三种规则对手 × 三种记忆模式，共 4,500 手；每手 100BB，配对发牌并交换庄位。画像在各组内累计，评估使用独立内存，不触碰训练记忆。报告默认保存到忽略的 `.data/evaluations/heads-up.json`。

本轮条件画像尚未证明收益提升；规则对手结果不代表 DSH 模型水平。命令、对照数据及限制见 [v0.2 评估报告](docs/evaluation-v0.2.md)。

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

详细说明见 [文档导航](docs/README.md) 和 [当前技术设计](docs/technical-design.md)；版本背景见 [设计演进](docs/design-evolution.md)。

## 许可证

本项目采用 [MIT License](LICENSE)，版权声明为 `Copyright (c) 2026 zeyuan`。允许使用、修改和商用，分发时须保留版权及许可声明。第三方依赖保留各自的许可证；本地预览包中 React 等组件的声明见 [第三方声明](THIRD_PARTY_NOTICES.md)。
