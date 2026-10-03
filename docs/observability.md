# 可观测性

## 当前范围

本版本提供三层调用链、Langfuse 本地查看、结构化日志，以及 HTTP/SSE 和 Aegra 的基础指标。基础设施通过 Compose 的 `observability` profile 启动，默认开发流程保持按需启用。

链路为：浏览器 `web.submit` → server HTTP span → `server.agent` → Python `agent.execute` → LangGraph 自动生成的模型、工具和节点 span。各层通过 OTLP 导出到 Collector，再由 Collector 发送到 Langfuse；指标由 Prometheus 收集，Grafana 展示。

## 跨队列传播

server 使用 LangGraph SDK 的 `onRequest` 将当前 W3C Trace Context 写入 HTTP header 和 `config.metadata.otel_trace_context`。Aegra 自身持久化运行配置，Redis worker 读取相同配置后调用 graph factory。

Python 使用 Aegra 官方支持的 context-manager factory，在实际执行期间恢复 OTel 上下文，并在退出时清理。模型和工具追踪复用 Aegra 已有的 OpenInference instrumentation。该接入不修改 Aegra 源码、队列或数据表。MCP 工具定义和模型初始化通过异步缓存复用，Aegra 继续为每次运行复制 graph 并注入 checkpointer。

读取 schema、checkpoint 或会话状态时，factory 通过 `runtime.execution_runtime` 识别非执行请求，不创建 `agent.execute` span。

## 标识与生命周期

| 标识 | 含义 |
| --- | --- |
| `trace_id`、`span_id` | 遥测调用链及节点 |
| `thread_id` / Langfuse session | 会话 |
| `agui_run_id` | 一次提交或人工审核后的恢复提交 |
| `aegra_run_id` | 底层执行 |

HTTP 重试创建新的提交 trace，运行标识继续用于关联同一逻辑提交。人工审核暂停结束当前执行，恢复提交创建新 trace。浏览器断开只结束客户端和 SSE 观测，后台执行继续使用持久化的父上下文。

server 的 `app.stream.outcome` 表示流连接结果，不能代替 Aegra 的持久化运行结果。`finished`、`interrupted`、`error` 和 `disconnected` 分开统计。HTTP response duration 仅测量响应建立时间，SSE duration 测量连接生命周期。

浏览器 `app.first_text_received_ms` 测量收到第一个非空文本 delta 的时间；它不包含 Markdown 渲染和文字动画的延迟。A2UI 处理错误记录到提交 span，渲染错误作为带 surface ID 的独立错误 span。

## 本地启动

```sh
make dev-observability
```

首次启动需要下载 Langfuse、ClickHouse、MinIO、Collector、Prometheus 和 Grafana 等镜像。Langfuse 使用独立的 PostgreSQL、Redis 和数据卷。

| 服务 | 地址 | 本地账户 |
| --- | --- | --- |
| Langfuse | http://127.0.0.1:3031 | `developer@example.com` / `playground-local-password` |
| Grafana | http://127.0.0.1:3032 | `developer` / `playground-local-password` |
| Prometheus | http://127.0.0.1:9091 | 无 |
| Collector OTLP HTTP | http://127.0.0.1:4318 | 仅本机 |

Langfuse 自动初始化 `Agent Playground` project。前端通过同源 `/telemetry/v1/traces` 转发遥测，浏览器不持有 Langfuse 密钥。前端 SDK 按启用开关动态加载。

Grafana 自动载入 `Agent Playground` 看板，展示采集目标健康状态、SSE 连接结果及 p95 耗时、Collector 导出队列和错误。`make dev-observability` 启动应用后才会产生对应指标；只有基础设施启动时，Aegra 采集目标可能显示为不可用。

应用进程在后台运行，日志写入 `.dev/`。运行 `make dev-stop` 停止三个应用进程；观测基础设施可用 `make infra-down` 停止。

也可分别执行 `make observability-up`、`make agent-observability`、`make server-observability` 和 `make web-observability`。应用各自读取自己的 `.env`，这些命令通过进程环境设置本地观测入口。

手动配置时，Python 的 `OTEL_EXPORTER_OTLP_ENDPOINT` 需要完整 `/v1/traces` 路径，server 使用不带路径的 OTLP base URL，web 设置 `VITE_OBSERVABILITY_ENABLED=true`。修改 frontend 开关后需要重启 Vite；正式构建需在构建时配置该变量。

## 部署边界

Compose 提供本地开发配置和本地默认账户。部署时应替换账户、密钥和连接地址，并将 `/telemetry` 路由交给 server。指标抓取目标必须调整为部署环境的服务地址；本地配置中的 `host.docker.internal:2026` 用于宿主机运行的 Aegra。

应用使用 SDK 批量、有界异步导出；Collector 故障不会阻止提交和执行，队列满时可能丢弃遥测。运行数据仍以业务数据库为准。

当前尚未接入集中日志存储、主机/PostgreSQL/Redis exporter、最终运行状态同步及业务告警。日志可按 trace ID 查询终端输出；server 使用 Pino，Python 复用 Aegra 的 structlog。实际队列等待时间、首次可见文字时间和 MCP stdio 子进程内部 span 尚未单独测量，工具调用侧 span 已由 LangChain instrumentation 提供。

## 验证

`make check` 包含上下文恢复、并发隔离、异常清理、浏览器 propagation、server 请求适配，以及真实 PostgreSQL/Redis worker 的断流测试。测试使用受控模型，不调用外部模型服务。Langfuse Compose 启动及实际入库需要单独验证，不能由单元测试结果推断。
