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
