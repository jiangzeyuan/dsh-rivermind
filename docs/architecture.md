# RiverMind 架构与第一个里程碑

## 谁负责什么

牌局状态只由 PokerTable 管理。界面和 Agent 都只能提交行动，不能发牌、修改底池或决定胜负。

PokerService 负责轮次调度，绑定人类请求到 human 座位，为 Iris 提供冻结的观察视图，并在行动截止后执行明确标注的兜底。

DshOpponent 负责真实 DSH 运行时接入。当前是一个对手；后续每个座位会拥有单独的 DshOpponent、会话和记忆命名空间。

    牌桌 UI → PokerService → PokerTable
                     ↓
               DshOpponent → DSH agents.create
                     ↓
       自己的观察 / 公开对手记忆 / 可见信息胜率估算 / 提交行动

不同时引入 AgentScope。先把 DSH 运行时及边界掌握清楚，规则和记忆接口则保持可替换。

## DSH 插件接入

- Host 导出 name、inject、apply，按生命周期创建牌桌服务。
- 客户端通过 dsh.client 与 ./client 导出参与 DSH 模块加载。
- 浏览器代码构建为 __ModuleLoader__.load 的 CJS factory，复用 DSH 的 React 实例。
- 注册 main 面板 rivermind，以及 sidebar.panellist 的导航项。
- 通过 Connection 的受认证 /api 路径注册精确 Fetch 路由；客户端使用 connection.rpc.call。
- 卸载时移除注册与样式，取消决策并释放 Agent。

此实现针对已安装的 0.2.0-rc.2；DSH API 仍处于预览期，升级时需要重新检查边界。

## Agent 的权限

创建全新的 sessionId，省略 seed 和 parentAgent。不给对手 fork 掌握全部底牌的会话。

在 setup 中完成：

1. tools.restrict({ allow: [] }) 移除全部全局工具。
2. tools.presentAs('native') 使用原生函数调用，避免继承编程 Agent 的 PTC 执行器。
3. systemPrompt.suppressRuntimeContext() 移除工作区等动态上下文。
4. 提供完整的扑克玩家提示。
5. 只注册四个玩家专用工具。

工具通过闭包绑定当前 Iris 的观察和记忆。模型无法通过传入任意 playerId 读取其他玩家。

这些是应用与 Agent 的能力边界，不构成针对本机管理员或其他有文件权限进程的操作系统沙箱。

## 行动与超时

每次决策绑定 handId 和 revision。submit_action 检查令牌、金额、类型和记忆引用（必须先通过 recall_opponent 实际检索），第一次提交后立即关闭该请求，再由规则引擎复核后应用。

不能把 whenIdle 等同于“收到本次决策结果”。它只用于开始下一次输入前的生命周期协调；真正的结果关联由当前提交工具的 Promise 完成。

预算：25 秒、最多 6 次工具调用、单次模型响应最多 2048 输出 token。有效提交调用 concludeTurn，阻止无意义的后续模型步骤。超时取消 Agent 的当前输入，并在有免费过牌时过牌，否则弃牌；事件 source 为 fallback。

## 信息边界

- 对局中只能看到自己的底牌、已经发出的公共牌和公开行动。
- 未来公共牌和实际剩余牌组不会传入 Agent，也不会传入胜率工具。
- 对手弃牌后仍不展示其底牌；双方摊牌才公开底牌。
- 对手的简短决策理由在手牌结束后仅向人类复盘界面开放。
- 记忆仅从公开行动统计生成，不读取复盘理由或未公开底牌。
- 已结束手牌的复盘文件与 Agent 记忆输入分离。

## Memory 的第一个版本

目前是有证据的统计记忆，并非自动学习到更优策略。

每手结束后更新 Iris 对 human 的画像，去重依据为 handId。每条快照有版本 ID 和证据手牌列表。规则陪练只有积累至少十手公开行为后，才会因高弃牌率小幅调整施压阈值；真实 DSH Agent 按工具检索结果决策。

复盘保存该手更新前的记忆快照，便于解释决策时实际可用的证据。牌局中途不更新画像，以保持该手内的记忆版本一致。

## 后续里程碑

1. 六人桌：座位与 PlayerId 泛化、多方底池、边池、短额全下后的加注重开规则；每个 AI 的私有观察与持久身份独立。
2. 完整复盘：历史手牌选择、逐步回放、决策与证据跳转。
3. 可检索经验：统计、假设和局面经验分层，加入样本数、置信度与适用条件。
4. 评估：固定对手池、配对随机种子、无记忆 / 统计记忆 / 检索记忆对照。
5. 策略迭代：候选经验与策略版本，离线验证后发布，保留回滚。

六人桌不能直接复用双人退款算法；必须先实现并验证边池和重开规则，再接五个真实 Agent。

## 参考

- [DSH 插件入门](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)
- [Agent 核心](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/core)
- [工具作用域](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools)
- [客户端模块](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/client-modules)
- [UI 面板布局](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-layout/README.md)
