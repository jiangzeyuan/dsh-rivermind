# RiverMind 诊断与原始会话日志

适用版本：`0.3.2`；原始日志说明对照 DSH 桌面版 `0.2.0-rc.2`。诊断资料与原始上下文有不同用途。

## 1. 在牌桌中查看与复制

点击标题行右侧的小文档图标，浮层中可查看并复制 JSON，关闭或按 Esc 返回；不自动上传资料。

| 入口 | 包含的资料 |
| --- | --- |
| 安全兜底提示 | 最近一次兜底的运行诊断；牌局进行中不含牌力、记忆证据 |
| 历史复盘的决策卡片 | 正常 AI、规则陪练与兜底各自已保存的决策 Trace |
| 历史复盘的记忆卡片 | 该手开始前保存的公开统计快照 |
| 玩家记忆的摘要 / 条件卡片 | 当前总体或指定条件的统计与证据编号 |
| 玩家记忆的证据手牌 | 按需读取该手全部 Iris 决策 Trace；超出最近复盘窗口时说明无法读取 |

决策报告包含可用的模型选择与实际请求模型、耗时、预算、工具名称 / 成败 / 耗时、金额事实、抽样结果、记忆提供 / 读取 / 引用，以及结构化失败原因。统计快照不是模型调用 Trace。

这些资料**没有**完整提示词、模型原始消息、工具原始参数 / 返回值、底牌或凭证。旧记录缺失的字段不会补造；剪贴板不可用时选中只读 JSON，支持手动复制。

## 2. 原始上下文与工具详情在哪里

DSH 自己保存内部会话事件。先从该次诊断中取 `trace.sessionId`，例如 `rivermind-iris-…`，再定位默认路径：

```text
~/.dsh/sessions/_no-cwd/<sessionId>/session.v4.jsonl.zstd
```

设置 `DSH_HOME` 时，根目录改为 `$DSH_HOME/sessions/`。Iris 没有工作目录，因此在 `_no-cwd` 下。若显式关闭日志压缩，文件名为 `session.v4.jsonl`；具体 root / compression 可由 DSH 配置覆盖。规则陪练没有 LLM 会话日志。创建或持久化阶段失败、尚未写出文件时也不能补回历史。

Iris 被标记为内部子会话，不显示为普通聊天入口；不能依靠侧栏聊天页面查看它的完整输入。原始日志由 DSH 持久化服务负责，与 RiverMind 的 `reviews.jsonl`、`hands.jsonl` 和记忆文件分开。

## 3. 解压后应看哪些事件

`.zstd` 是 Zstandard 压缩文本，不能直接作为 JSON 打开。下面的示例需要提供 `zstdDecompressSync` 的 Node.js 24，将真实 sessionId 填入第一行。DSH 追加写入多个压缩帧，需逐帧解码；建议完全退出 DSH 后读取，避免末尾帧仍在写入。解压结果写到临时目录，不打印到终端：

```sh
RIVERMIND_SESSION_ID="rivermind-iris-替换为实际编号"
RIVERMIND_LOG_ROOT="${DSH_HOME:-$HOME/.dsh}/sessions"
RIVERMIND_LOG_OUT="$(mktemp -d)"
node --input-type=module - "$RIVERMIND_LOG_ROOT/_no-cwd/$RIVERMIND_SESSION_ID/session.v4.jsonl.zstd" "$RIVERMIND_LOG_OUT/session.jsonl" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
const [input, output] = process.argv.slice(2);
const bytes = readFileSync(input), chunks = [];
for (let offset = 0; offset < bytes.length;) {
  const decoded = zstdDecompressSync(bytes.subarray(offset), { info: true });
  const consumed = decoded.engine.bytesWritten;
  if (!Number.isSafeInteger(consumed) || consumed <= 0) throw new Error('无法读取完整压缩帧');
  chunks.push(decoded.buffer);
  offset += consumed;
}
writeFileSync(output, Buffer.concat(chunks), { mode: 0o600 });
console.log('已解压到：' + output);
NODE
```

macOS 官方桌面安装的内置 Node 也可执行这一脚本：将 `node` 换为 `ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"`。未压缩的 `.jsonl` 可以直接在本地编辑器打开。

| 事件 | 能观察什么 |
| --- | --- |
| `request/header` | 该请求所用模型配置、推理等级与工具定义；相同头可能复用此前记录 |
| `request/context` | 模型上下文窗口等运行时元数据，不能单独当作完整消息列表 |
| `system/message` / `developer/message` / `user/message` | 模型可见的提示与输入，包括牌局观察、当前记忆摘要 |
| `turn/start` / `step/start` | 一次行动以及其中各次模型请求的边界 |
| `assistant/message` / `assistant/attempt` | 已保存的模型响应或中断尝试，及提供方实际返回并记录的用量 |
| `tool/call` | 工具名称、调用编号、原始参数 |
| `tool/result` | 对应工具的原始返回或错误，通过调用编号与来源事件关联 |
| `step/end` / `turn/end` / `llm/retry` | 步骤结束、行动结束类型和重试记录 |

## 4. 如何定位某一次 Iris 行动

1. 在诊断中记下 `sessionId`、`startedAt`、手牌 `handId` 和决策动作。每次输入的牌局观察含 `handId` / `revision`，可据此定位那次行动。
2. 找到对应模型可见输入和 `turn/start`，沿同一 `turn` 查看各个 `step` 的工具调用、结果、模型响应和结束类型。
3. 一次行动可以包含多次 LLM 请求：模型调用工具，工具结果加入上下文，模型再继续决策。一个 Iris 会话也可以包含多手牌，不能把整份日志当作一次思考。
4. 若要重建某次请求的完整 `messages`，应按事件顺序恢复当时的会话 surface，处理追加、替换、裁剪、压缩等操作，再使用当时生效的请求头与工具定义。DSH AgentLoop 从 `session.deriveMessages()` 构造请求；仅把当前手牌附近的事件拼接起来不等于实际上下文。

RiverMind 的 `decisionId` 是插件自己的诊断编号，没有额外写入 DSH 原始事件；应使用上述时间及观察编号关联。DSH 日志是 Harness 的请求与响应事件，不能保证等同于提供方 SDK 序列化后的逐字 HTTP 请求，也不能恢复提供方未返回的内部推理。

原始日志可能包含 Iris 私牌和完整提示、模型内容，适合牌局结束后本地调试。对外反馈问题时优先复制诊断 Trace，并注明 DSH 版本；原始日志不要作为普通复盘展示或随项目提交。
