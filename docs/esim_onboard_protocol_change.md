# eSIM 引导模式手动控制接口 — 协议变更说明

分支：`feat/esim-ble-provisioning`（在 eSIM 蓝牙下发功能 `b51a603` 基础上的增量变更，尚未提交）
关联文档：[esim_ble_download_interface_design.md](esim_ble_download_interface_design.md)（完整设计；本文档只描述**本次新增/变更**的部分，供 App 对接和评审快速核对差异）

## 1. 变更摘要

新增两个 App -> MCU 命令：

| 命令 | 用途 |
|------|------|
| `esim.onboard_enter` | 手动强制进入 eSIM 引导模式 |
| `esim.onboard_exit`  | 手动强制退出 eSIM 引导模式 |

除此之外，App<->MCU 的 JSON 协议（命令/事件格式、字段、错误码约定）**无其它改动**，已有的 `esim.start`/`esim.data`/`esim.list`/`esim.enable`/`esim.delete` 等接口行为不变。

以下为配合本次功能的内部实现改动，**不改变协议**，但会影响实际表现，列出供评审/测试关注：

| 改动 | 说明 |
|------|------|
| `req_body` 缓冲 1024 -> 4096 字节 | 模组上行 HTTPS 请求体（转发给 App 的 `esim.https_req.r.body`）不再在 1024 字节处截断；此前若 `authenticateClient` 等请求体超过 1024 字节会被截断，现在不会，需要回归测试确认大请求体场景 |
| `lte_runtime` 工作队列栈 2048 -> 4096 字节 | 配合上面缓冲扩大、规避栈溢出风险 |
| `esim_session_init()` / `lte_register_esim_onboard_cb()` 调用位置从 `lte_uart_task_init()` 内部迁移到 `lte_adapter.c` 的 `lte_netif_register()` | 模块初始化顺序重构，不影响外部行为 |
| `force_switch_state` 改为 `atomic_t`，新增内部接口 `lte_uart_task_force_state()` | 让状态机的"强制跳转"可被非 lte_runtime 线程安全调用，并立即重新调度，不必等下一拍 tick；是 `esim.onboard_enter/exit` 做到"立即生效、无需重启"的底层支撑 |

## 2. 背景

开机引导模式目前的判定逻辑（见设计文档第 6 节状态机）只看 `AT+QCCID` 读到的 ICCID 是否为占位值：

- 无可用 ICCID -> 自动进入 `LTE_STATE_ESIM_ONBOARD`，暂停正常注册流程，提示 App 写卡；
- ICCID 看起来"有效" -> 直接走正常注册流程，不会再触发引导模式。

问题：如果设备已经写入了一张**能通过 ICCID 检测、但实际不可用**的 eSIM（profile 损坏、运营商配置错误等），开机检测会一直认为"有卡"，永远不会再自动进入引导模式，也就没有办法再走 BLE 写卡流程去补救。

`esim.onboard_enter` / `esim.onboard_exit` 是手动兜底：不依赖 ICCID 检测，App 可以随时强制让设备进入/退出引导模式，且**不需要重启设备**。

## 3. 接口详情

### 3.1 `esim.onboard_enter`

App 请求：

```json
{"c":"esim.onboard_enter"}
```

同步响应（成功）：

```json
{"c":"esim.onboard_enter","r":0}
```

同步响应（失败 — 当前有下载会话或 profile 管理命令在执行）：

```json
{"c":"esim.onboard_enter","e":-16}
```

`-16` = `-EBUSY`。

成功后的行为：

1. 持久化标志 `esim_onboard_forced` 写为 `true`（NVS，跨重启保留）；
2. 立即让 LTE 状态机跳转到 `LTE_STATE_ESIM_ONBOARD`，不等当前调度周期；
3. App 随后会立刻收到一次引导提醒事件，之后每 60 秒重发一次：

```json
{"e":"esim-pending","r":{"st":"no_profile"},"ts":...}
```

### 3.2 `esim.onboard_exit`

App 请求：

```json
{"c":"esim.onboard_exit"}
```

同步响应（成功）：

```json
{"c":"esim.onboard_exit","r":0}
```

同步响应（失败 — 当前有下载会话或 profile 管理命令在执行）：

```json
{"c":"esim.onboard_exit","e":-16}
```

成功后的行为：

1. 清除持久化标志 `esim_onboard_forced`；
2. 若设备**当前确实处于**引导模式：停止 `esim-pending` 提醒，并把状态机切回 `LTE_STATE_WWAN_RESTART` 恢复正常注册流程；
3. 若设备当前**不在**引导模式：只清标志，不影响现有连接（覆盖"标志刚设上还没生效就被撤销"的场景）。

## 4. 行为细则

- **互斥**：两个命令都与下载会话（`esim.start` 之后）及 profile 管理命令（`esim.list`/`esim.enable`/`esim.delete`）互斥，复用既有的 `s_busy` 标志，避免在 AT 命令在途时打断状态机或模组上下文。判定/执行是同步完成的，不走异步事件。
- **与自动引导模式判定的关系**：开机时的判定逻辑变为 `onboard_forced || !lte_iccid_usable(iccid)`，即手动标志可以覆盖 ICCID 检测结果，强制下次开机也进入引导模式。
- **标志的自动清除**：引导模式下执行 `esim.enable` 成功后，会自动清除 `esim_onboard_forced`（认为问题已修复）。如果不清除，写完新卡重启后仍会被强制标志拽回引导模式，导致用户写卡后设备"看起来又卡住了"。
- **幂等性**：两个命令都可重复调用；重复 `enter` 只是再次置位标志并重新触发跳转，重复 `exit` 在已退出状态下只是空操作返回 `r:0`。

## 5. 兼容性

- 纯增量新增命令，不修改任何已有命令/事件的字段或语义；旧版本 App 不调用这两个命令时完全不受影响。
- 错误码、互斥语义与现有 `esim.*` 命令族保持一致（`-EBUSY` 含义不变）。

## 6. 测试用例（新增部分）

| 用例 | 期望 |
|------|------|
| 正常注册流程中调用 `esim.onboard_enter` | 同步 `r:0`；立即收到 `esim-pending`；之后每 60s 重发 |
| 引导模式中调用 `esim.onboard_exit` | 同步 `r:0`；停止 `esim-pending`；状态机回到正常注册流程并最终联网 |
| 未处于引导模式时调用 `esim.onboard_exit` | 同步 `r:0`；不影响当前连接 |
| 下载会话进行中调用 `esim.onboard_enter` / `esim.onboard_exit` | 同步返回 `e:-16`，状态机不受影响 |
| 手动进入引导模式后写卡并 `esim.enable` 成功 | `esim_onboard_forced` 被自动清除；重启后不再被强制拽回引导模式 |
| 手动进入引导模式后，未 enable 直接重启 | `esim_onboard_forced` 仍为 true，重启后直接进入引导模式（即便 ICCID 检测认为"有卡"） |
| 大于 1024 字节的模组上行 HTTPS 请求体（如 `authenticateClient`） | `esim.https_req.r.body` 不再被截断，App 能拿到完整请求体 |

## 7. 待确认 / 风险

- 当前 `esim.onboard_enter` 失败只返回 `-EBUSY`，没有区分"下载会话占用"和"profile 命令占用"，App 侧若需要展示更具体的提示，需要固件后续细化错误码。
- `req_body` 扩容到 4096 后仍是固定上限；若实际遇到更大的模组请求体，会继续按当前截断逻辑处理，需要结合真实 SM-DP+ 交互数据确认 4096 是否足够。
