# RiverMind 发布指南

推进顺序：**完成 v0.3 → 发布 npm 包 → 验证按包名安装 → 提交市场收录 PR**。Git push、npm 发布和市场收录是不同的阶段。

## 当前状态

| 阶段 | 状态 | 完成凭据 |
| --- | --- | --- |
| v0.3 功能与文档 | 已完成并合入 `main` | 42 项测试、浏览器交互检查、完整设计和 CHANGELOG |
| v0.3.2 补丁 | 已提交并推送 `main`，对应标签 `v0.3.2` | 提交 [`e3f9339`](https://github.com/jiangzeyuan/dsh-rivermind/commit/e3f9339)；57 项测试、实际 DSH 合成运行及 Trace 浏览器验收 |
| npm 发布准备 | 已完成 | 57 项测试、`npm run release:check` 和预构建包检查通过 |
| npm 正式发布 | `0.3.0`、`0.3.1`、`0.3.2` 已发布，`latest` 为 `0.3.2` | [npm 包](https://www.npmjs.com/package/dsh-rivermind)；registry 版本 / Git 提交一致，npm README 与发布标签中的源码一致 |
| 从 registry 按包名安装 | `0.3.0`、`0.3.1`、`0.3.2` 已通过独立 Web profile 验收；另验证 `0.3.1 → 0.3.2` | 实际牌桌、规则牌局、Trace / 记忆复制、模型说明和重启后数据保留；未调用模型 |
| 市场收录 | 2026-10-07 已提交 dshmarket 收录申请，等待检查、审核合并与同步 | [收录 PR #6768](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6768)；提交申请不等于已上架 |

### 已完成的 npm 安装验收

2026-10-06，从公开 registry 分别安装 `dsh-rivermind@0.3.0` 和 `dsh-rivermind@0.3.1` 到两个全新 `DSH_HOME`，命令为 `dsh plugin --profile web add`，没有使用本地目录或 `.tgz`。

- 实际 DSH Web 载入牌桌入口与客户端，包中的 Host、客户端及 bundle 均存在。
- 决策预算默认收起；在界面保存 120 秒 / 16 次后生效。
- BB 箭头步长为 0.5，选择 2.5 BB 时确认按钮同时显示 50 筹码。
- 完成一手规则陪练牌局，筹码守恒，更新公开行为记忆并保存历史复盘；未调用模型。
- 关闭并重启该独立 DSH，确认预算、长期记忆与历史复盘保留。

`0.3.1` 仅更新发布说明与包简介，其 registry 安装检查也已通过；Host、客户端及配置与 `0.3.0` 一致。桌面真实应用及真实模型稳定性不能由上述规则模式验收替代。

### v0.3.2 发布与升级验收

2026-10-06，`dsh-rivermind@0.3.2` 正式发布，registry 确认 `latest = 0.3.2`，`gitHead = e3f93390466beeb2c79ce4a56b676843327aa006`，对应 [源码标签](https://github.com/jiangzeyuan/dsh-rivermind/tree/v0.3.2)。npm README 与该提交的 README 完全一致，包含紧凑 Trace、模型选择与升级操作、原始上下文日志说明。

- 在全新独立 Web profile 中从公开 registry 按精确包名安装，没有使用本地源码或 `.tgz`。
- 在另一个已安装 `0.3.1` 的独立 profile 中重新执行 `dsh plugin --profile web add dsh-rivermind@0.3.2`，确认同名包更新为 `0.3.2`；不需要先卸载。
- 两个 profile 均通过真实 DSH 牌桌加载、0.5 BB 步进与双单位金额、预算保存、完整规则牌局、筹码守恒、记忆更新和历史复盘检查。
- 验证正常规则决策的紧凑 Trace 浮层与真实剪贴板复制、玩家记忆快照、证据手牌的逐条决策资料，以及原生模型问号提示。
- 两个 profile 均在重启后保持预算、长期记忆与历史可读；没有真实模型或付费 API 调用，不代表远端模型稳定性已验收。

正式包名统一为 `dsh-rivermind`，与仓库名一致。package metadata、bundle、客户端模块 ID 与 lockfile 均使用同一名称；公开 registry 的 `latest` 以 `npm view dsh-rivermind dist-tags.latest` 的查询结果为准。旧本地开发包的迁移步骤见 [README](../README.md#从旧的本地开发包升级)。

## 1. 完成并固定 v0.3 源码

在当前源码目录执行：

```sh
npm ci
npm run release:check
```

检查包括类型、57 项测试、构建，以及真正的 `.tgz` 包内容、Host 导出和客户端模块注册。包必须包含构建产物、bundle、许可和 CHANGELOG；不得包含 `.data`、凭据或机器配置。

`0.3.0` 的已验收提交已从 `feat/v0.3` 快进合入 `main`。后续发布前，同样确保源码、README 和即将发布的包一致。没有分叉时可使用：

```sh
git switch main
git merge --ff-only feat/v0.3
git push origin main
```

若不能快进，先正常审查合并，避免用重置或强推覆盖远端。发布完成后再创建对应版本 tag / GitHub Release，并使用 [CHANGELOG](../CHANGELOG.md) 的本版本内容作为面向使用者的 Release notes。

## 2. 登录 npm 并发布

需要先有 npm 账号，确认所用包名可以由该账号发布。登录在本机终端与浏览器完成：

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

不要把 token 写入项目或提交 `.npmrc`。如果 npm 要求 2FA，按登录 / 发布提示完成。仓库已移除 `private: true`，并设置公开 registry、仓库地址和 `publishConfig.access`；`prepublishOnly` 会再次验证和构建。

名称、源码版本和包检查通过后执行：

```sh
npm publish --access public --registry=https://registry.npmjs.org/
npm view dsh-rivermind@0.3.2 version dist.tarball --registry=https://registry.npmjs.org/
```

成功查询到 `0.3.2` 及 tarball 才算发布完成；不要将 dry run、Git push 或本地 `.tgz` 当作 npm 正式发布。已经发布的名称 / 版本不能直接覆盖，修复后升级补丁版本并追加 CHANGELOG。

## 3. 在独立 DSH 环境按包名验收

使用临时 DSH home，避免影响已有模型配置、训练记忆或安装实例。以下步骤从公开 registry 安装精确版本，不能用本地目录 / `.tgz` 替代这一阶段：

```sh
RIVERMIND_VERIFY_HOME="$(mktemp -d)"
DSH_HOME="$RIVERMIND_VERIFY_HOME" dsh plugin --profile web add dsh-rivermind@0.3.2
DSH_HOME="$RIVERMIND_VERIFY_HOME" dsh --profile web --dump-config
DSH_HOME="$RIVERMIND_VERIFY_HOME" dsh web --no-open --port 3081
```

按启动日志给出的认证地址打开页面。先用规则陪练验收：侧栏入口可见、发牌与合法行动可用、快捷金额和预算设置可用、历史复盘可读取，重启后预算与记忆保留。退出后保留必要的日志记录，再清理这个临时测试目录。

常规用户目标命令是：

```sh
dsh plugin --profile web add dsh-rivermind@0.3.2
dsh web
```

桌面用户需先初始化应用并完全退出，将 `web` 改成 `desktop`，安装后重新打开应用。模型模式另外在自己已配置模型的 DSH 中验收，记录耗时 / 失败 / 用量；一次规则模式走通不代表真实模型稳定性已验证。

## 4. 提交社区市场收录 PR

目标是 [awesome-dsh-plugin 目录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，不是市场应用仓库。根据其 [贡献规则](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)，提交一个 YAML 文件，README 由目录自动生成。

1. 确认仓库公开、创建满一天、有实际工作代码和 `dsh.bundle`；为仓库添加 `dsh-plugin` topic。
2. npm 发布与按包名验收完成后，fork 该目录，在 `data/plugins/` 新增 `jiangzeyuan__dsh-rivermind.yml`。
3. 复制本项目的 [条目草稿](publishing/jiangzeyuan__dsh-rivermind.yml)。`category: fun` 对应当前扑克训练功能，描述只写已经实现的双人 Agent、公开统计记忆和复盘。
4. 以 [PR 文案草稿](publishing/market-pr.md) 为基础，补入实际 npm 地址、版本和安装验收记录，再提交 PR。
5. 合并后等待目录 / 市场同步，确认条目出现且安装来源正确，再在 README 更新“已收录”。提交 PR 本身不等于上架。

[dshmarket 提交说明](https://github.com/dsh-market/dsh-market#submit-your-plugin)指出它读取上述目录，合并后才由目录和市场更新；同步时间取决于其维护与任务运行，不保证立即可见。

## 本次市场提交记录

2026-10-07，向 `awesome-dsh-plugin/awesome-dsh-plugin` 提交 [收录 PR #6768](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6768)，标题为 `Add jiangzeyuan/dsh-rivermind`，分类为 `fun`。

- 仓库公开时间已超过一天，已添加 `dsh-plugin`、`deepseek-harness` topics，并声明 `dsh.bundle`。
- [fork 的 `add-rivermind` 分支](https://github.com/jiangzeyuan/awesome-dsh-plugin/tree/add-rivermind) 只新增一个 `data/plugins/jiangzeyuan__dsh-rivermind.yml`，目录格式与重复项检查通过。
- [提交文案](publishing/market-pr.md) 说明已发布的 `0.3.2`、三版按包名安装及升级验收，未将规则模式验收描述为模型稳定性验证。
- 在线 CI 与审核状态以 PR 页面为准。只有维护者合并、目录更新且市场出现实际条目后，才能记录为已收录。

## 可覆盖的社区市场与目录

以下入口的核对日期为 2026-10-07，按本项目的推进顺序排列，不作为用户规模排名。各渠道独立维护；向一个目录提交申请，不代表其他渠道同时收录。

| 渠道 | 使用形式 | 作者收录方式 | RiverMind 当前进度 |
| --- | --- | --- | --- |
| [dshmarket](https://github.com/dsh-market/dsh-market) / [awesome-dsh-plugin](https://awesome-dsh-plugin.com/) | 安装到 DSH 的可视化市场；npm 包名 `dshmarket` | 向 `awesome-dsh-plugin/awesome-dsh-plugin` 提交单条 YAML 的 PR；合并后同步 | 已提交 [#6768](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6768)，等待审核和同步 |
| [DSH Plugin Hub](https://github.com/dshplugin/dsh-plugin-hub) / [dsh-plugin.org](https://dsh-plugin.org/zh/submit) | 安装到 DSH 的插件中心；npm 包名 `dsh-plugin` | 公开仓库加 `dsh-plugin` topic，按提交页要求提供安装、许可与兼容信息；可提交收录 Issue | 已满足 topic 发现前提，本次未另行提交；实际收录未验收 |
| [DSH Directory](https://dsh.directory/) | 网页插件目录 | 网站 Submit 入口提交仓库；也从 `dsh-plugin` topic 发现候选，检查静态 bundle 后收录 | 已满足 topic 发现前提，本次未另行提交；实际收录未验收 |
| [dsh.fish](https://github.com/stvlynn/dsh.fish) | 网页目录、CLI 与 `@dsh-fish/hub` 插件 | 从 `dsh-plugin` topic 抓取，并按仓库元数据识别可安装内容 | 已满足 topic 发现前提，实际索引未验收；作为补充渠道 |

本次优先提交 `dshmarket` 使用的目录。后续可依次核对其他渠道中的实际条目；未出现时，使用各自的提交入口补充申请，避免重复提交。引用入口：[dshmarket 提交说明](https://github.com/dsh-market/dsh-market#submit-your-plugin)、[DSH Plugin 提交要求](https://dsh-plugin.org/zh/submit)、[DSH Directory FAQ](https://dsh.directory/)、[dsh.fish 作者说明](https://github.com/stvlynn/dsh.fish#quick-start)。

## 后续维护

每个版本更新当前设计、设计演进和 CHANGELOG，然后执行相同检查、发布新版本、按精确版本验收。`npm pack` 可用于分发预构建包，但不能替代 registry 安装验证。市场有多个实现，本指南对应 `dshmarket` 的社区目录，不代表所有市场会自动收录。

安装与构建行为依据 [DSH 官方插件打包教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)，公开包发布依据 [npm 官方文档](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)。
