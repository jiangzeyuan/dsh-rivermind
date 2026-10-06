# RiverMind 发布指南

推进顺序：**完成 v0.3 → 发布 npm 包 → 验证按包名安装 → 提交市场收录 PR**。Git push、npm 发布和市场收录是不同的阶段。

## 当前状态

| 阶段 | 状态 | 完成凭据 |
| --- | --- | --- |
| v0.3 功能与文档 | 已完成开发，当前分支 `feat/v0.3` | 42 项测试、浏览器交互检查、完整设计和 CHANGELOG |
| npm 发布准备 | 元数据与预构建包检查已准备 | `npm run release:check` |
| npm 正式发布 | 待发布；发布者需完成 npm 身份验证并具备包发布权限 | npm 可查询到目标版本 |
| 从 registry 按包名安装 | 待 npm 发布后验收 | 干净 DSH profile 的安装与实际加载检查 |
| 市场收录 | 条目草稿已准备，尚未提交 | 收录 PR 合并，目录与市场更新 |

正式包名统一为 `dsh-rivermind`，与仓库名一致。package metadata、bundle、客户端模块 ID 与 lockfile 均使用同一名称；公开 registry 未查到某名称不等于保证它可以注册，最终以发布校验为准。旧本地开发包的迁移步骤见 [README](../README.md#从旧的本地开发包升级)。

## 1. 完成并固定 v0.3 源码

在当前源码目录执行：

```sh
npm ci
npm run release:check
```

检查包括类型、42 项测试、构建，以及真正的 `.tgz` 包内容、Host 导出和客户端模块注册。包必须包含构建产物、bundle、许可和 CHANGELOG；不得包含 `.data`、凭据或机器配置。

当前开发提交从 `feat/v0.3` 推送。正式 npm 发布前，把已验收提交合入 `main`，确保源码、README 和即将发布的包一致。没有分叉时可使用：

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
npm view dsh-rivermind@0.3.0 version dist.tarball --registry=https://registry.npmjs.org/
```

成功查询到 `0.3.0` 及 tarball 才算发布完成；不要将 dry run、Git push 或本地 `.tgz` 当作 npm 正式发布。已经发布的名称 / 版本不能直接覆盖，修复后升级补丁版本并追加 CHANGELOG。

## 3. 在独立 DSH 环境按包名验收

使用临时 DSH home，避免影响已有模型配置、训练记忆或安装实例。以下步骤从公开 registry 安装精确版本，不能用本地目录 / `.tgz` 替代这一阶段：

```sh
RIVERMIND_VERIFY_HOME="$(mktemp -d)"
DSH_HOME="$RIVERMIND_VERIFY_HOME" dsh plugin --profile web add dsh-rivermind@0.3.0
DSH_HOME="$RIVERMIND_VERIFY_HOME" dsh --profile web --dump-config
DSH_HOME="$RIVERMIND_VERIFY_HOME" dsh web --no-open --port 3081
```

按启动日志给出的认证地址打开页面。先用规则陪练验收：侧栏入口可见、发牌与合法行动可用、快捷金额和预算设置可用、历史复盘可读取，重启后预算与记忆保留。退出后保留必要的日志记录，再清理这个临时测试目录。

常规用户目标命令是：

```sh
dsh plugin --profile web add dsh-rivermind@0.3.0
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

## 后续维护

每个版本更新当前设计、设计演进和 CHANGELOG，然后执行相同检查、发布新版本、按精确版本验收。`npm pack` 可用于分发预构建包，但不能替代 registry 安装验证。市场有多个实现，本指南对应 `dshmarket` 的社区目录，不代表所有市场会自动收录。

安装与构建行为依据 [DSH 官方插件打包教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)，公开包发布依据 [npm 官方文档](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)。
