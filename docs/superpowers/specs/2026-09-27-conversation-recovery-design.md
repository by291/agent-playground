# Workflow 输出与会话恢复设计

## 目标

Workflow 每完成一步就展示一张 A2UI 卡片，并在审核节点暂停。页面刷新、浏览器断线或 TypeScript server 重启后，用户仍能看到已完成的步骤、当前审核请求和最终回复。运行中的 token 预览不要求持久化。

## 职责边界

| 组件 | 职责与权威数据 |
| --- | --- |
| Aegra / LangGraph | 执行状态、checkpoint 和 interrupt |
| Python agent | 生成并持久化 workflow 步骤输出，再推送实时事件 |
| TypeScript server | AG-UI 适配、提交控制、运行映射、会话读取 |
| Web | 渲染实时内容与持久快照，提交审核响应 |

Aegra 的内部表和 checkpoint 位于 `aegra` schema；会话和 workflow 输出位于 `public` schema。Python 和 server 分别通过自己的 `APP_DATABASE_URL` 访问应用表。Python 管理 `workflow_outputs`，server 管理 `conversations`、`conversation_runs` 和 `conversation_messages`，并只读 workflow 输出。

## 数据模型与身份

- `thread_id` 标识会话。浏览器生成的 AG-UI `runId` 标识一次提交，Aegra run ID 标识底层执行；二者分开保存。审核恢复使用新的 AG-UI run。
- `conversation_runs` 以 AG-UI run ID 为主键，记录 thread、提交序号、输入 message ID、可空的 Aegra run ID、原请求和状态，并保存 checkpoint 同步标记和 interrupt 集合。提交状态包括 `prepared`、`dispatching`、`running`、`interrupted`、`completed`、`failed` 和 `submission_unknown`。
- `conversation_messages` 保存用户消息和已提交 checkpoint 的完整 assistant 文本消息，`(thread_id, message_id)` 唯一。会话内的提交序号决定消息所在回合，`message_order` 保存同一回合内的 checkpoint 顺序；用户消息为 0，assistant 消息从 1 开始。
- `workflow_outputs` 保存完整的 A2UI v0.9 消息、稳定输出 ID、首次产生它的 AG-UI run ID、workflow 调用 ID、步骤 ID、版本和会话输出序号。一个 workflow 调用跨审核前后保持同一个 `ToolRuntime.tool_call_id`。

Workflow surface 使用 `urn:agent-playground:workflow:v1` 自定义 catalog。Python 输出 `WorkflowPanel`、`WorkflowText` 和 `WorkflowSteps` 组件消息；Web 将同名组件注册为 React 实现。`WorkflowText.text` 使用官方 `DynamicString` schema，支持字面量和数据路径绑定。`/a2ui` 预览页每次选择一个组件，左侧用本地 Monaco 编辑器展示并修改 `web/src/a2ui/examples/` 中的 JSON 文件内容，右侧用同一 A2UI renderer 展示结果；解析或组件校验失败时保留上次有效预览。

同一调用的步骤输出以 `(thread_id, workflow_call_id, step_id, version)` 幂等写入。当前输出版本为 3，payload 使用官方 `{ messages: [...] }` 模型。旧版本不再兼容，已有数据保留，升级后使用新会话；恢复旧步骤时明确报错。当前版本的重试若产生不同 payload，报冲突。会话输出序号在锁定 `conversations` 行的事务中分配，因此并行调用按持久化提交顺序展示，不假定它们有业务上的先后关系。

## A2UI 消息处理

- `CUSTOM` 事件名称为 `a2ui`，value 为输出 ID、序号、run/tool 归属和标准 `messages`。这些身份字段属于项目传输封装，组件消息遵循官方 v0.9 schema。普通工具结果不当作 A2UI 消息解析。
- Web 将业务封装校验与官方消息校验分开。每个会话使用一个官方 `MessageProcessor`，实时事件与恢复快照共用入口；支持纯更新批次、多 surface、组件和数据更新、删除。
- 输出按 ID 与序号去重，相同身份的不同内容明确报错。对象键顺序不影响重复判断。缺失序号先等待快照补齐，再处理后续消息；旧快照不会重建已有 surface 或回退数据。
- Surface 在创建时确定 tool 归属，后续更新不重新归属。React renderer 只消费 processor 的 surface model，会话切换时释放 processor。
- 非法协议或渲染错误对用户可见。官方 processor 不提供批次回滚；批次处理失败时隐藏该批次涉及的 surface，保留其他 surface，并停止该会话实例的后续 A2UI 处理。
- 当前 workflow 仍为每个步骤创建独立 surface；增量处理能力由 runtime 和预览样例验证。A2UI action 到后端的链路尚未实现。

## 提交与执行

1. Web 在请求前保存 thread ID、message ID、AG-UI run ID 和提交内容。server 在锁定会话行的事务中检查当前运行与审核状态，记录提交和用户消息，再独占地将 `prepared` 改为 `dispatching`。
2. server 忽略浏览器提供的 `forwardedProps`，自行注入 `metadata.agui_run_id`、`onDisconnect: "continue"` 和 `onRunCreated`。回调保存 Aegra run ID；server 对外发送的 `RUN_STARTED`、`RUN_FINISHED` 始终使用本次 AG-UI run ID。
3. Python workflow 从运行配置获取 thread ID 和 AG-UI run ID。每个步骤先写入 `workflow_outputs`，再发送带有输出 ID、原 run 归属和 A2UI payload 的 `a2ui` 事件。写入失败时步骤失败，不进入缺少持久审核卡片的 interrupt。
4. 审核 interrupt 携带 workflow 调用 ID。server 将终态 checkpoint 的完整 interrupt 集合同步到应用表，在准入事务中核对提交的 ID 和已持久化的审核输出，再将响应交给 Aegra 恢复执行。相同的已准备请求先按原内容识别，避免重启重试被新审核校验拒绝。

同一 thread 同时只允许一个待提交或运行中的请求。准入只检查最新运行，普通消息不能越过当前未处理的审核；历史暂停记录不阻塞已恢复后的新消息。重复的相同提交只入库一次；已开始 dispatch 的请求不再次调用 Aegra。

## 恢复与对账

`GET /conversations/:threadId` 返回持久消息、按会话输出序号排序的卡片、运行摘要和当前 interrupt；`GET /conversations` 返回最近的会话 ID。Web 以 message ID 和输出 ID 合并实时内容与快照，页面重载后先读取 server。只有服务端没有该提交或提交仍为 `prepared` 时，Web 才用原 ID 和原内容继续提交。运行中定期刷新快照；完整 assistant 文本可从 Aegra checkpoint 补齐。

正常路径通过已保存的 Aegra run ID 直接查询状态。若 server 在 Aegra 创建 run 后、保存回调映射前退出，恢复时最多读取该 thread 最新的一条 Aegra run；仅当其 `config.metadata.agui_run_id` 精确匹配时回填。无法确认映射时标记 `submission_unknown`，停止自动重发，不遍历历史 run；后续读取仍可通过同样的有限查询确认映射。外部绕过 server 在同一 thread 创建更新的 run 时，也按此规则保守处理。

快照读取与上游同步分开。只有最新运行进入终态且尚未同步时才读取 checkpoint，批量补入缺失消息并持久化同步标记；后续轮询读取应用表。恢复观察结果只能更新自己读取时的运行状态和映射，避免旧查询覆盖新的回调或终态。

浏览器断开不取消 Aegra 执行。步骤输出已写入但实时事件未送达时，快照仍能恢复卡片；server 重启后继续从 Aegra 和应用表读取状态。

## 一致性边界

- `workflow_outputs` 与 Aegra checkpoint 不共享事务。若输出已提交而 checkpoint 未提交，该卡片可能对应最终失败的 run；界面需同时呈现运行状态。
- 保存有序的 A2UI 消息批次，重载时从头送入会话 processor；实时期间只补充未处理的输出。
- 不保存完整 AG-UI 事件流或运行中 token。精确事件回放不属于本设计。
- `submission_unknown` 表示暂时无法确认底层 run 是否创建；后续有限查询仍无法确认时需要人工对账。它不表示执行成功，也不能作为自动重发依据。

## 验收要求

1. 审核前后的卡片、interrupt 和最终 assistant 回复在刷新与 server 重启后可恢复。
2. AG-UI 开始与结束事件使用同一个对外 run ID；卡片保留首次写入时的 run 归属。
3. 重复提交、步骤重试和重复读取不生成重复运行或卡片；内容冲突被明确拒绝。
4. 并行 workflow 调用的输出序号连续，各自的审核响应与 workflow 调用 ID 对应。
5. 无法确认 Aegra run 创建结果时进入 `submission_unknown`，不遍历历史，也不自动再次执行。
