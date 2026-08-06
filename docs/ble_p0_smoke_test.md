# BLE P0 冒烟自动化与实机验收

本文用于记录 SAT-11 的可重复测试入口、实机前置条件和证据格式。自动化默认使用 fake/test seam，不访问真实蓝牙适配器；实机步骤必须由测试人员显式执行。

## 自动化范围

| 风险 | 自动化证据 | 通过标准 |
| --- | --- | --- |
| HTTP 方法、参数和错误可观察性 | `internal/business/ble/routes_test.go` | 错误状态码稳定，服务端原始错误保留 |
| 扫描结果去重、过滤、RSSI 排序 | `internal/business/ble/ble_test.go` | 同 MAC 合并、名称前缀过滤、RSSI 降序 |
| 连接、订阅、写入和断开测试接缝 | `bleManager` 注入操作 + 路由测试 | 无适配器环境可重复执行，不泄漏平台对象到 HTTP 场景 |
| SSE 初始状态、通知和取消清理 | `TestBLEEventsStreamInitialStateNotificationAndCleanup` | 事件格式正确，请求取消后 subscriber 清零 |
| 失效 GATT 清理 | `TestInvalidateConnectionCleansTransportAndBroadcastsReason` | 当前连接、重组 timer、pending ACK 全部释放，并广播原因 |
| 分帧、CRC、MTU 边界、2048 B 上限 | `transport_test.go` | 帧长不超过限制，CRC 和总长正确，2049 B 在写入前拒绝 |
| ACK、NAK、超时和重试 | `TestSendTransportWithRetryHandlesACKNAKAndTimeout` | 最多重试 2 次，每次使用新 MSG_ID，无 pending 泄漏 |
| 接收重组、CRC 错误、乱序和 5 秒超时 | `transport_test.go` 接收测试 | 成功回 ACK；错误分别回 CRC/SEQ/TIMEOUT NAK；不广播坏载荷 |
| 前端连接状态、部分能力、断开对账、手动重连、SSE 隔离 | `frontend/src/views/ble/connectionState.test.ts` | 状态转换和操作门控符合连接工作台契约 |

本地执行：

```powershell
go test ./...
go test -race ./internal/...
go vet ./internal/... .

Set-Location frontend
npm test
npm run type-check
```

若 Go 默认缓存目录受运行环境限制，可把 `GOCACHE` 指向当前任务可写的临时目录；这属于环境调整，不应提交缓存文件。

## 实机环境记录

执行前复制并填写下表；任何必填项未知时，结论只能标记为“阻塞”，不能写“通过”。

| 项目 | 必填记录 |
| --- | --- |
| 上位机代码 | 本地提交哈希、工作区是否干净 |
| 工具版本 | `go version`、`node --version`、`npm --version` |
| PC | Windows 版本及构建号 |
| 蓝牙适配器 | 厂商、型号、硬件 ID、驱动版本 |
| 目标设备 | 型号、序列号或匿名测试编号 |
| 固件 | 完整版本、构建日期、协议版本 |
| 无线环境 | 距离、同频干扰、是否连接其他 BLE 设备 |
| 时间基准 | 本地时区和开始/结束时间 |

## Windows 实机冒烟步骤

这些步骤只做扫描、连接、通知、读写和断连；不执行 DFU、恢复出厂、证书/密钥变更、生产网络或真实 SM-DP+ 操作。

1. 确认 Windows 蓝牙开启，记录适配器和驱动；启动上位机并保存启动日志。
2. 打开连接工作台，确认先显示 `syncing`，随后根据 `/api/ble/state` 进入 `idle` 或 `subscribing`，不能在同步前启用业务操作。
3. 输入约定名称前缀开始扫描，记录首个结果时间、名称、完整 MAC、RSSI；连续扫描应按 MAC 去重并按 RSSI 降序。
4. 停止扫描，确认不再产生新的 `/scan` 请求；分别保存“有设备”和“无匹配设备”的界面证据。
5. 选择目标设备并连接，确认一次用户操作只产生一次 `/connect`；记录连接耗时、服务发现和四个订阅结果。
6. 若 TRANSPORT 不存在，确认保持物理连接并显示 `connected_partial`；大包相关能力禁用，原始错误可见。若 APP/NUS/DFU 订阅失败，同样记录失败通道和影响范围。
7. 在允许的测试命令上完成一条小包写入和 Notify 回包；保存请求、响应、service/characteristic UUID、时间戳和 payload 长度。敏感 payload 必须脱敏。
8. 使用固件提供的 CH=14 ECHO 或等价测试钩子发送 MTU 边界附近数据和 2048 B 数据；核对分片序号、ACK、CRC 与耗时。没有明确测试钩子时本步骤标记阻塞，不向业务通道发送探测数据。
9. 在连接状态下关闭目标设备或移出范围，确认同地址 `disconnected` 事件立即禁用业务操作、清理 pending 命令并保留手动“重新连接”入口。
10. 恢复设备后点击“重新连接”，确认无需重新扫描，只对上次地址发起一次连接；记录成功或原始失败原因。
11. 主动断开，确认 `disconnecting` 后以 `/state` 对账。模拟请求失败但设备仍连接时，界面必须恢复之前的连接态，不得误报已断开。
12. 断开 SSE 网络通道但保持 BLE 连接，确认只改变 `eventStream`，不能把 BLE 状态改成 `disconnected`；SSE 恢复后显示 `open`。

## 证据和结果格式

每次执行保存到独立目录，建议命名为 `YYYYMMDD-HHMM_<device>_<firmware>`，至少包含：

- `environment.md`：上述环境表；
- `server.log`：上位机日志，包含扫描、连接、订阅、写入、ACK/NAK、断连时间线；
- `http.jsonl`：关键 HTTP 请求/响应，秘密和业务数据脱敏；
- `sse.jsonl`：关键 SSE 事件；
- `screenshots/`：状态、失败反馈和恢复入口；
- `result.md`：用例、通过/失败/阻塞、缺陷归属、复现步骤和残余风险。

失败归类必须区分：上位机/测试工具缺陷、BLE 链路或环境问题、协议实现问题、设备应用问题、规格缺口。单次扫描不到设备或一次断连不能直接判定产品缺陷。

## 当前实机阻塞项

在以下信息齐备并实际执行前，不能声称端到端 BLE 冒烟通过：

- 目标设备型号和可识别的测试编号；
- 固件完整版本及与 `docs/ble_transport_protocol.md` 对应关系；
- Windows 版本、蓝牙适配器型号和驱动版本；
- 安全的 ECHO/测试命令及允许发送的数据范围。
