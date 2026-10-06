# RiverMind 文档导航

当前源码版本：`0.3.0`。技术设计说明当前实现，设计演进记录各版本取舍，CHANGELOG 汇总用户可见的变化。

| 文档 | 回答的问题 | 维护方式 |
| --- | --- | --- |
| [当前技术设计](technical-design.md) | 现在怎么工作：规则、Agent、预算、记忆、复盘和边界 | 随实现更新，唯一完整设计规范 |
| [设计演进](design-evolution.md) | 每个版本为什么改、方案和验证是什么 | 按版本追加，不复述全部设计 |
| [CHANGELOG](../CHANGELOG.md) | 用户升级后能获得哪些变化、要注意什么 | 按版本追加，最新在前 |
| [发布指南](publishing.md) | 从完成版本到 npm、安装验收和市场收录 | 操作步骤与发布状态 |
| [v0.2 评估报告](evaluation-v0.2.md) | 4,500 手牌规则记忆对照的结果与限制 | 保留实验基线 |

快速定位当前方案：

- 项目问题与范围：[第 1 节](technical-design.md#1-当前项目解决什么问题)。
- 分层和一次请求：[第 3～4 节](technical-design.md#3-系统分层)。
- 下注金额、BB 步进与全屏布局：[下注交互](technical-design.md#42-先选金额再确认)。
- Agent 工具、异步关联与预算：[第 5～6 节](technical-design.md#5-iris-如何作为-agent-工作)。
- 记忆在哪里、何时更新、引用能证明什么：[第 7 节](technical-design.md#7-记忆如何保存和使用)。
- 未亮牌、历史窗口和模型解释：[第 8 节](technical-design.md#8-历史复盘能解释什么)。
- 工程验证与设计要点：[第 10～11 节](technical-design.md#10-当前验证证明了什么)。

安装与常用操作见 [项目 README](../README.md)，架构相关章节可通过 [架构入口](architecture.md) 快速定位。
