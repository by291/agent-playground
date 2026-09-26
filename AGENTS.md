# 项目规约

## 项目目标

- 这是验证 agent runtime 想法的项目。优先快速、清楚地跑通想法，避免为尚未出现的需求增加复杂度。
- 澄清影响实现的关键需求后直接推进；根据改动范围选择必要的设计和验证步骤，不要求固定流程。

## 仓库导航

- `agent_playground/`：Python agent、tools、MCP 和 workflow，由 Aegra 提供 Agent Protocol 服务。
- `server/`：TypeScript 后端，将 Aegra 的运行流提供为 AG-UI 接口。
- `web/`：TypeScript 前端，展示对话和 A2UI 内容。
- `compose.yaml`：本地 PostgreSQL、Redis 等基础设施；`tests/`：Python 侧测试。
- 完整启动步骤、当前能力、协议传递方式和已知限制见 `README.md`；不要把容易变化的项目现状重复写进本文件。

## 实现约定

- Agent 逻辑放在 Python 项目中；`server/` 处理协议适配和 HTTP，`web/` 处理交互与展示。修改跨层链路时先确认各层职责。
- 优先使用现有库和协议提供的类型、模型与适配器，避免重复手写 AG-UI 或 A2UI 协议实现。
- Python 使用 uv，TypeScript 使用 pnpm；通过各自的包管理器增删依赖并更新锁文件。仅在验证目标需要时引入新库或基础设施。
- 基础设施通过 Docker Compose 维护。根目录、`server/` 和 `web/` 各自使用自己的 `.env`，避免跨项目读取配置。
- 代码是写给人阅读的：使用清晰命名和直接结构；只在意图、边界条件或不直观的处理需要解释时添加注释，不要让文件主要由注释构成。

## 开发与验证

- `make help` 查看快捷命令，`make setup` 准备依赖和环境文件，`make dev` 启动本地开发环境。
- 修改后运行与改动相关的检查；涉及跨项目链路时可运行 `make check`。`make test` 和 `make check` 的 PostgreSQL 测试通过 Testcontainers 启动临时容器，需要 Docker daemon。
- 运行方式、环境变量、对外行为或已知限制发生变化时更新 `README.md`；长期约定或目录职责发生变化时更新本文件。

## 语言与提交

- 文档可以使用中文；代码及注释、测试、配置中的自定义文本、界面文案和 Git 提交信息使用英文。
- Git 提交标题使用 `type: short description`，例如 `feat: add experiment entry point`。类型按改动选择 `feat`、`fix`、`docs`、`refactor`、`test` 或 `chore`；描述具体改动，避免含糊的 `update`。
