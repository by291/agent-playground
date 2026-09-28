# 会话恢复验证记录

日期：2026-09-27

## 范围

在隔离的本地 PostgreSQL 数据库中运行 Aegra、TypeScript server 和 web，使用确定性的假模型驱动 workflow。测试结束后清理了临时服务和数据库。设计约束见 [Workflow 输出与会话恢复设计](superpowers/specs/2026-09-27-conversation-recovery-design.md)。

| 场景 | 结果 |
| --- | --- |
| 单个 workflow 审核 | 审核前 3 张卡片、审核后 1 张卡片；刷新后审核表单、四张卡片和最终 assistant 文本可恢复。审核前后两次 run 各有独立的 AG-UI 与 Aegra ID。 |
| 两个并行 workflow 调用 | 同一 run 中出现两个独立 interrupt；一次提交完整审核响应后均完成。8 条输出序号连续，前 6 条属于审核前 run，后 2 条属于恢复 run；刷新后无重复卡片。 |
| 浏览器断线与 server 重启 | 延迟假模型运行时刷新浏览器，Aegra 继续执行；审核恢复运行期间重启 server，页面从持久状态取得最后一张卡片和完整回复。 |
| 提交幂等与未知状态 | 相同提交只入库一次，`prepared` 只能独占领取一次。没有 Aegra thread 的 `dispatching` 提交进入 `submission_unknown`，快照可读取，不能再次领取。 |
| 输出幂等与排序 | 重复步骤键返回原输出 ID、序号和 run；相同键的不同 payload 报冲突。10 个并发写入分配连续的会话输出序号。 |
| Aegra run 映射 | 正常路径由 `onRunCreated` 保存 ID；缺失映射时只查询最新一条 run。两条 run 的线程上，最新 ID 可匹配，旧 ID 返回空，不遍历历史。 |

`make check` 通过：7 个 Python 测试、4 个 server 测试、Python 与 TypeScript 类型和格式检查，以及 web 构建。重构目录后再次运行 `make check` 和 server `/health` 导入检查，均通过。

这些验证没有使用真实 DeepSeek 输出，也没有覆盖 Aegra 进程自身崩溃恢复或生产负载下的时延。

## 自定义 A2UI catalog（2026-09-28）

Workflow 输出改为项目自定义 catalog 后，`make check` 通过：9 个 Python 测试、4 个 server 测试、4 个 web 测试及前端构建。Web 测试覆盖 catalog 注册组件与预览样例的一一对应、样例消息能被 A2UI `MessageProcessor` 处理，以及旧 Basic Catalog 卡片仍可读取。PostgreSQL 回归测试验证旧版卡片在中断后恢复时沿用原输出 ID、run 和 payload，新调用写入版本 2，版本 2 内的冲突仍会报错。

浏览器打开 `/a2ui` 后，`WorkflowPanel`、`WorkflowText`、`WorkflowSteps` 的示例均实际渲染，并验证聊天页可通过键盘进入预览页。另将 Python `experiment_card` 按运行时相同的 `exclude_none=True` 序列化后，交由 Web 的解析器与 `MessageProcessor` 处理，成功创建 `WorkflowPanel` surface。该轮没有重跑真实 Aegra/模型链路。

## JSON 样例编辑预览（2026-09-28）

样例改为独立 JSON 文件，页面一次展示一个组件，左侧是本地打包的 Monaco JSON 编辑器，右侧是同一 A2UI renderer 的效果。`make check` 通过：9 个 Python 测试、4 个 server 测试、7 个 web 测试及前端构建。Web 测试验证编辑后的 JSON 可生成预览，错误 JSON 或其他 catalog 不能替换预览。

浏览器验证组件切换、修改 JSON 后实时更新效果、无效 JSON 时显示错误并保留上次有效效果，以及键盘操作重置样例。编辑只作用于当前页面状态，不会写回仓库的 JSON 文件。Monaco 资源随前端构建输出，不依赖外部 CDN；该预览页按路由延迟加载，聊天页不加载编辑器。

## 会话级 A2UI runtime（2026-09-28）

当前实现采用输出版本 3，不兼容旧包装、旧事件名称或 Basic Catalog。上文关于旧卡片兼容的记录只描述当时的版本。

| 验证范围 | 结果 |
| --- | --- |
| Python workflow 与 PostgreSQL | 10 个测试通过；输出使用官方 `A2uiMessageListWrapper`，持久化后发出 `a2ui` 事件；旧输出版本被拒绝，当前版本重复写入保持身份，内容冲突报错。 |
| 官方消息与会话 processor | 覆盖纯更新、多 surface、组件与数据更新、删除、动态文本绑定、乱序排队与补齐、重复快照、JSONB 对象键顺序、身份冲突和会话隔离。 |
| AG-UI 实时订阅 | 使用真实 `HttpAgent` 消费受控 SSE；重复的后续输出触发一次缺口恢复，完整快照不会重建已有 surface；非法 A2UI 事件显示错误，文本流继续处理。 |
| 处理和绑定错误 | 批次中途失败时隐藏涉及的 surface，并停止后续处理。增量绑定的非法路径及函数参数中的嵌套路径在官方组件 schema 校验阶段被拒绝，避免 SDK 回调吞错后留下旧文字。 |
| 浏览器 | 受控 HTTP/SSE 服务配合实际前端：绑定内容更新、surface 删除、刷新恢复、新会话清空、未知组件显示错误；JSON 预览保持有效结果，非法组件或路径不能替换预览，重置恢复样例。 |
| Python → Web 序列化 | 按 workflow 相同方式序列化 Python 输出，交由官方 Web schema 和会话 runtime 处理，成功生成 `WorkflowPanel` surface。 |

Python 类型、lint 和格式检查通过；TypeScript 类型、lint、格式检查、server/web 测试与前端构建通过。复审发现的未知组件预览和增量绑定吞错问题均已补充回归验证。

这轮没有重跑真实 Aegra/模型端到端链路。当前示例 workflow 仍按步骤创建独立 surface；增量处理由受控流和官方 resolver 验证。A2UI action 到后端的链路尚未实现。

## 职责拆分与恢复边界（2026-09-28）

`make check` 通过：17 个 Python、13 个 server、32 个 web 测试，三层类型检查、lint、格式检查和前端构建通过。

| 验证范围 | 结果 |
| --- | --- |
| 运行状态竞争 | 迟到的创建回调保留终态；旧映射查询和旧运行状态观察不能覆盖更新后的映射或终态。 |
| 原子准入 | 已准备的审核提交可按原请求重试；恢复完成后的历史暂停记录不阻塞新消息。 |
| checkpoint 同步 | 终态同步标记持久化，重复读取不再请求该 checkpoint；批量消息按显式顺序恢复，不依赖时间戳排序。 |
| 有限映射恢复 | 未知提交可由后续最新一条 native run 查询确认；不重发请求、不遍历历史。 |
| 前端 trace 与资源 | 成功补齐乱序输出不会将提交 trace 标记为错误；预览替换、无效编辑、重置和卸载明确释放 model。 |
| Python 输出发布 | 持久化完成后才发布；写入失败不发布；重试仍使用首次持久化的输出身份和 run 归属。 |

另使用临时 PostgreSQL、Redis、真实 Aegra worker 和受控 workflow 模型验证 server 链路：首次暂停得到 3 条输出与 1 个 interrupt，审核恢复后得到第 4 条输出和完整回复，随后普通消息能够再次启动 workflow。三次运行的 AG-UI 开始与结束 ID 一致，输出序号连续，审核前后输出保留各自首次产生时的 run 归属。

本轮没有重新执行浏览器视觉检查、外部模型调用或 Langfuse 入库验证；真实 worker 验证使用受控模型。
