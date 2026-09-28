# 项目规约

## 项目目标

- 这是持续演进的 agent 应用项目，在验证 agent runtime 能力的同时，逐步提升工程严谨性并向生产使用靠拢。
- 实现应保持清晰的职责边界、可理解的状态模型和可回归验证的行为；涉及运行、恢复和持久化的改动优先保证一致性与资源生命周期。根据实际需求演进，避免提前引入缺乏依据的复杂度。
- 澄清影响实现的关键需求后直接推进；根据改动范围选择必要的设计和验证步骤，不要求固定流程。

## 仓库导航

- `agent_playground/`：Python agent、tools、MCP 和 workflow，由 Aegra 提供 Agent Protocol 服务；`db/` 管理数据库契约、连接和输出持久化，workflow 输出发布与业务步骤分开。
- `server/`：TypeScript 后端；`agent/` 适配 Aegra 与 AG-UI，`conversation/` 管理运行和恢复，`db/` 管理应用数据，根目录保留 HTTP 入口和配置。
- `web/`：TypeScript 前端；`src/app/` 管理入口、路由、配置和全局 provider，`src/pages/` 组合页面并拥有开发预览，`src/features/` 按 conversation 与 A2UI 能力组织 API、模型、运行和 UI；`src/components/ui/` 存放 shadcn/ui 基础控件，`src/styles/` 管理主题与全局样式。
- `shared/`：TypeScript 应用共用的运行状态契约；AG-UI 和 A2UI 类型继续使用官方库。
- `compose.yaml`：本地 PostgreSQL、Redis 等基础设施；`tests/`：Python 侧测试。
- 完整启动步骤、当前能力、协议传递方式和已知限制见 `README.md`；不要把容易变化的项目现状重复写进本文件。

## 实现约定

- Agent 逻辑放在 Python 项目中；`server/` 处理协议适配和 HTTP，`web/` 处理交互与展示。修改跨层链路时先确认各层职责。
- 优先使用现有库和协议提供的类型、模型与适配器，避免重复手写 AG-UI 或 A2UI 协议实现。
- Python 使用 uv，TypeScript 使用 pnpm；通过各自的包管理器增删依赖并更新锁文件。仅在验证目标需要时引入新库或基础设施。
- 基础设施通过 Docker Compose 维护。根目录、`server/` 和 `web/` 各自使用自己的 `.env`，避免跨项目读取配置。
- 代码是写给人阅读的：使用清晰命名和直接结构；只在意图、边界条件或不直观的处理需要解释时添加注释，不要让文件主要由注释构成。
- 前端依赖从 app 指向 pages、features 和基础模块；跨 feature 只通过公开入口，当前只允许 conversation 依赖 A2UI。feature 内部直接引用内部模块，避免通过自己的公开入口形成循环；测试与实现就近放置，浏览器流程放在 `web/tests/e2e/`。
- 运行状态写入归 conversation 层，恢复查询不能覆盖更新后的映射或终态；快照读取与上游同步分开。前端 Query 负责取数和交付结果，session 负责状态协调，资源由创建者明确释放。

## 代码风格与可读性

参考 [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html#control-flow-statements-and-blocks) 的控制流与函数排版，以及 [PEP 8](https://peps.python.org/pep-0008/#blank-lines) 的逻辑分段。以下是本项目的明确要求；TypeScript 不采用指南中允许单行 `if` 的例外。

- TypeScript 的 `if`、`else`、`for`、`while`、`do` 始终使用花括号，语句另起一行。即使只有 `return`、`throw` 或 `continue` 也一样；禁止 `if (condition) return value;` 和无花括号的多行分支。
- Python 的分支、循环和异常处理也将语句另起一行；禁止 `if condition: return value` 和用分号拼接多条语句。
- 函数内部按逻辑阶段分组，例如输入校验、准备数据、执行或持久化、组装返回值。不同阶段之间保留一个空行，相关的连续声明或操作可以放在一起；不要每行都加空行，也不要把多阶段函数挤成连续代码。
- TypeScript 的声明组后、控制流块前后、最终 `return` 前保留一个空行；块内只有一条语句时不额外加空行。函数或方法之间保留一个空行。Python 模块级函数和类之间保留两个空行，类方法之间保留一个空行。
- 简单的三元表达式和单表达式箭头函数可以保留；禁止嵌套三元表达式。涉及多个判断、赋值或副作用时使用展开的分支或具名函数。
- 使用表达领域含义的变量和函数名。复杂条件先提取具名变量，避免让读者同时解码条件、状态和副作用；不要仅为缩短行数增加抽象层。
- 注释解释意图、协议边界、竞争条件和非直观处理，不重复代码正在做的事情。必要注释紧贴对应逻辑分组。
- Prettier 与 Ruff 负责缩进、换行和基础格式；共享的 `eslint.style.mjs` 约束 TypeScript 花括号、嵌套三元和语句间空行。自动格式化不能替代对逻辑分组的人工检查。源码与测试采用相同规则，第三方生成的数据库快照保持生成格式。

## 开发与验证

- `make help` 查看快捷命令，`make setup` 准备依赖和环境文件，`make dev` 启动本地开发环境。
- 修改后运行与改动相关的检查；涉及跨项目链路时可运行 `make check`。`make test` 和 `make check` 的 PostgreSQL 测试通过 Testcontainers 启动临时容器，需要 Docker daemon。
- TypeScript 测试使用 Vitest；纯逻辑与服务端测试使用 Node 环境，前端 DOM 交互测试通过文件级 `@vitest-environment jsdom` 指定环境。前端共享 setup 负责 DOM 清理与 mock、timer 的恢复；需要 PostgreSQL 的服务端测试使用 `.integration.test.ts` 命名，以便单独运行。
- 运行方式、环境变量、对外行为或已知限制发生变化时更新 `README.md`；长期约定或目录职责发生变化时更新本文件。

## 语言与提交

- 文档可以使用中文；代码及注释、测试、配置中的自定义文本、界面文案和 Git 提交信息使用英文。
- Git 提交标题使用 `type: short description`，例如 `feat: add experiment entry point`。类型按改动选择 `feat`、`fix`、`docs`、`refactor`、`test` 或 `chore`；描述具体改动，避免含糊的 `update`。
