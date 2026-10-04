# 通用对话审核机制

用户选择复用对话审核机制，SQL 保留为业务示例；workflow 继续用 Python/LangGraph 定义。

现有服务端、会话 runtime、composer 和视图直接依赖 SQL schema、SQL 工具名和 SQL 卡片里的回复字段。上一次整理解决了 Python 文件职责，没有消除这些跨层业务耦合。

## 边界

- 业务 workflow 决定如何获取、检查、修改和提交内容，以及当前版本能否接受。SQL 的 schema、检查 API、agent prompt、提交 API、回执和 SQL 卡片继续属于业务代码。
- 通用机制负责审核身份、对话反馈、accept/abandon、过期操作校验、当前版本的接受门槛、AG-UI resume、回复归档、卡片分组和历史。
- 不引入 workflow DSL、节点注册器、通用 agent prompt 或可配置任意动作框架。其他业务通过相同的审核和输出契约接入。

## 审核契约

`workflow_review` interrupt 只包含 `workflowCallId`、`revision`、`round`、`outputStepId`、`canAccept` 和展示文案（标题、接受按钮、输入提示、拒绝接受的原因）。业务内容由 A2UI 展示。响应保持 message/accept/abandon 与上述身份；反馈包括稳定的用户消息 ID。

Python 的 `wait_for_review()` 校验身份、消息和接受门槛；业务 graph 仍拥有状态转换。服务端校验当前 interrupt 和对应持久输出。只有唯一一个可对话审核等待时 composer 才发送反馈，多个/混合审核保留显式选择，不猜测目标。

## 输出契约

持久输出继续保存官方 A2UI 消息，并可携带 `workflow` 元数据：稳定的 assistant 回复（ID、内容），以及一个 surface 的展示归属（surface ID、分组 ID、锚定回复 ID）。A2UI 只处理官方消息；通用会话机制从元数据读取回复、当前卡片及历史，不解析业务组件。

输出落库后才发事件，幂等身份与 outputSeq 不变。回复在实时显示和 checkpoint 同步时按 ID 去重。业务卡片仅负责业务展示，新的 SQL 卡片不再承担消息归档职责。

## 历史数据与验证

用户明确允许删除旧历史，因此不保留 SQL interrupt/卡片转换、旧 checkpoint fixture 或发布格式重放兼容。现有旧 SQL 会话通过应用删除接口清理。验证当前格式的 checkpoint 恢复、检查失败及过期操作、解释不改变版本、放弃不提交和回执幂等。experiment workflow 保持原有表单审核行为。

用不含 SQL 字段的文案审核验证共享审核、会话路由、输出归档和展示归属，避免仅把 Sql 名字改成 Workflow。运行完整检查、浏览器回归及真实模型 SQL smoke；不把受控测试说成真实模型验证。
