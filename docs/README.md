# RiverMind 文档导航

当前版本是 `0.2.0`：双人牌桌、一个 Iris Agent、条件统计记忆、历史手牌复盘与规则评估基线。

先读 [v0.2 技术方案](technical-design-v0.2.md)。它从一次人类操作讲到 Agent 行动与记忆写盘，含流程图、模块与代码对照、虚构数据示例、验证范围和后续路线。

| 想了解的问题 | 阅读位置 |
| --- | --- |
| 项目现在解决什么、已经实现到哪里？ | [技术方案第 1 节](technical-design-v0.2.md#1-当前项目解决什么问题) |
| 界面、规则引擎、DSH 和记忆如何分工？ | [技术方案第 3 节](technical-design-v0.2.md#3-系统分层) |
| 点击一次操作后，系统具体发生什么？ | [技术方案第 4 节](technical-design-v0.2.md#4-一次操作如何走完整个系统) |
| Iris 有哪些工具，怎么提交决策？ | [技术方案第 5 节](technical-design-v0.2.md#5-iris-如何作为-agent-工作) |
| 怎么限制权限、拒绝过期动作和处理超时？ | [技术方案第 6 节](technical-design-v0.2.md#6-如何保证动作可靠信息公平) |
| 记忆保存在哪、格式是什么、何时更新、如何恢复？ | [技术方案第 7 节](technical-design-v0.2.md#7-记忆如何保存和使用) |
| 现有验证能证明什么？ | [技术方案第 10 节](technical-design-v0.2.md#10-当前验证证明了什么) |
| 可以和面试官讨论哪些亮点与难点？ | [技术方案第 11 节](technical-design-v0.2.md#11-可以与面试官讨论的点) |

[v0.2 评估报告](evaluation-v0.2.md)给出复现命令与本轮对照结果；[v0.1 方案](technical-design-v0.1.md)保留为历史记录。

[architecture.md](architecture.md) 保留为架构速查；[项目 README](../README.md) 负责安装、运行和发布说明。
