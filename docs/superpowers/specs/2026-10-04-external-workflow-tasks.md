# 外部异步任务与实时会话更新

用户要求模拟异步 API：提交后立即返回任务身份，外部任务经历多个中间状态后完成。外部更新驱动任务状态与 workflow；用户关闭会话后仍自动完成，打开时实时看到进度，重新打开恢复状态和结果。这是通用能力，报告生成只作为业务示例。

## 边界与契约

Python 保留业务 API 调用、LangGraph 节点和结果发布。共享 `external-task` 契约区分 queued/running/succeeded/failed，业务阶段用 stage/message/progress 表达。每个更新有递增 revision；重复相同 revision/内容幂等，旧更新忽略，同 revision 冲突与终态回退拒绝。任务属于 threadId、workflowCallId 和 stepId，任务身份从这三者稳定生成。外部 API 的 jobId 与平台任务身份可以不同。

TypeScript conversation 层保存任务与事件历史，接收回调，并在任务终态后创建后台 continuation run；中间状态不调用模型。Python 用 `workflow_external_wait` interrupt 等待结果，用户审核与外部等待保持独立。回调使用任务专属随机 token；token 不出现在公开快照或 URL。注册限定在已存在、未删除且具有运行记录的会话。

## 持久化与执行

任务创建和终态通知不依赖浏览器。后台 worker 在服务启动后扫描未处理任务；先同步原 run 的 checkpoint，再在会话锁下原子登记任务的 continuation run，复用既有 run 准入、映射与同步。后台 Aegra `runs.create` 不建立前端连接。当前 interrupt 的任务身份必须匹配；多个审核/任务可以按 interrupt ID 部分恢复。用户不能手工提交外部任务结果。

任务已完成但 interrupt 尚未保存时，更新保持待处理，稍后再续跑。run 已创建但响应丢失时，按既有 metadata 查询映射；不能确认的创建保持 submission_unknown，禁止盲目重复创建。这沿用当前 Aegra 创建不支持客户端幂等 ID 的边界，不宣称端到端 exactly-once。

继续运行期间 worker 同步后台 checkpoint 与最终消息/输出，无需用户访问快照。服务重启后重用已登记 continuation；正常运行和旧 checkpoint 的身份不改写。会话删除后不创建新 continuation，回调拒绝；关闭页面仅取消前端订阅，不取消任务。暂不支持主动取消外部任务或在同一会话等待期间开始另一个用户 turn。

## 实时更新与恢复

数据库提交后通过 PostgreSQL NOTIFY 广播会话变更。`GET /conversations/:threadId/events` 使用 SSE 发送失效通知；前端 Query 刷新权威快照，session 协调状态。任务、历史、消息和 A2UI 输出都来自持久快照。订阅建立/重连时主动获取快照，通知不是可靠事件日志；断开期间的更新由快照补齐。订阅资源在关闭/切换会话时释放。后台状态不得由浏览器 timer 或 GET 请求驱动。

前端通用任务卡显示阶段、进度、更新历史和继续执行状态，按 workflowCallId 附着原始 tool。未知归属保持可见。外部等待时 composer 说明正在等待任务，不显示用户审核按钮。当前流与订阅快照并存时保留现有消息合并与 run 终态防回退规则；任务 revision 不能被旧快照覆盖。

## 模拟业务与验证

`report-demo` API 独立模拟 queued → preparing → processing → finalizing → succeeded/failed。创建记录、时间与通知进度持久化；后台任务按时间发送回调，失败重试，进程重启不丢任务。报告 workflow 只注册任务、提交业务 API、等待终态、展示结果。复用已有 A2UI 组件和通用输出元数据。

验证重复/乱序/终态回退、非法 token、创建与早到回调、后台续跑冲突/映射不确定、服务恢复、浏览器关闭后自动完成、在线进度实时变化、重连恢复、资源释放，以及 SQL/experiment 回归。受控测试和真实 Python/模型验证分别记录。
