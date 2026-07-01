# eSIM 交互接口协议规范

版本：v1.0
适用方：App 开发团队
对应固件版本：v5.2.1+
关联文档：[BLE 大包传输协议规范](ble_transport_protocol.md)、[eSIM 引导模式手动控制接口](esim_onboard_protocol_change.md)

---

## 1. 概述

设备（MCU + eSIM 模组）通过一条 BLE GATT Characteristic（APP 通道，UUID `00000002-ffff-4fff-8fff-5a7e11a1ffff`）与 App 交换 **JSON 文本**。所有 eSIM 相关业务（profile 下载、profile 列表/启用/禁用/删除、引导模式进出、HTTPS 中转）都在这一条通道上以「命令 / 响应 / 事件」三种消息完成。

> ⚠️ eSIM 下载过程中模组会向 SM-DP+ 发起 HTTPS 请求，但模组本身不能联网，必须由 App 代为发起并把响应体分块回传。这是 eSIM 协议里最复杂的一环，见 [§7](#7-https-中转下载流程)。

### 1.1 通道与编码

| 项目 | 取值 |
|------|------|
| Service UUID | `00000001-ffff-4fff-8fff-5a7e11a1ffff` |
| APP Characteristic UUID | `00000002-ffff-4fff-8fff-5a7e11a1ffff` |
| 编码 | UTF-8 文本（JSON）|
| 分片机制 | 由 TRANSPORT 大包通道（`0000000e-...`）透明处理，业务层无需关心 |
| 帧分隔 | 通知可能携带半条 JSON，也可能一次携带多条 JSON；App 必须做**缓冲 + 流式 JSON 拼接**，不能按「一条通知 = 一条消息」处理（见 [§2.3](#23-收包与-json-拼接)）|

### 1.2 三类消息

| 类型 | 标识字段 | 方向 | 含义 |
|------|----------|------|------|
| **命令（Command）** | `c`（字符串）| App → MCU | App 主动请求 |
| **同步响应（Response）** | `c`（与命令同名）+ `r` | MCU → App | 对命令的即时应答 |
| **异步事件（Event）** | `e`（字符串）| MCU → App | 模组状态变化、流程进度、最终结果 |

判定规则：
- 有 `c` 字段 → 命令或同步响应（`c` 值与触发它的命令同名）；
- 有 `e` 字段且 `e` 是字符串 → 异步事件，`e` 的值就是事件名；
- 有 `c` 且同时有数值/对象型的 `e` → 该命令的**错误响应**，`e` 此时是结果码（见 [§3](#3-结果码约定)）。

---

## 2. 通用约定

### 2.1 命令统一格式

```json
{ "c": "<命令名>", "p": <可选参数对象或基础类型> }
```

- `c`：必填，命令名。
- `p`：可选。可以是对象（如 `{ "iccid": "8901..." }`），也可以是基础类型（数字/字符串）。无参数时省略 `p`。

### 2.2 响应/事件统一格式

**成功响应：**
```json
{ "c": "<命令名>", "r": <返回值> }
```

**错误响应：**
```json
{ "c": "<命令名>", "e": <结果码>, "m": "<可选错误描述>" }
```
> 错误响应里 `e` 是**数值或对象**（不是字符串）。若 `e` 是字符串，则这条消息是异步事件而非错误响应。

**异步事件：**
```json
{ "e": "<事件名>", "r": <事件数据>, "ts": 1234567890 }
```
- `e`：事件名（字符串，以 `esim.` 开头）。
- `r`：事件数据，结构随事件类型变化。
- `ts`：可选，毫秒级时间戳。

### 2.3 收包与 JSON 拼接

MCU 的通知是**流式文本**，存在三种情况：

1. 一条通知 = 一条完整 JSON；
2. 一条通知 = 半条 JSON（大消息被 BLE 分片，下一拍通知继续）；
3. 一条通知 = 多条 JSON 拼在一起（模组连续上行）。

App 必须：
- 维护一个接收缓冲区 `buffer`，每收到通知就 `buffer += text`；
- 用**增量 JSON 解析器**从缓冲区头部不断切出完整 JSON 对象，每切出一个就 dispatch，剩余未闭合部分继续留在缓冲区等下一拍；
- 不要假设一次 `notify` 对应一条消息。

判定一条命令的同步响应是否到齐：在缓冲区解析出的载荷里，找到 `c` 与所发命令同名的第一个对象即可（不要把后续的异步事件当作响应的一部分去等）。

> ⚠️ 错误响应（`c` + 数值 `e`）也应被视为「响应已到齐」，否则会被后续连续事件推迟。

### 2.4 命令超时与重发

| 命令类别 | 推荐同步等待（maxWait）|
|----------|------------------------|
| `esim.start` | 默认（30s）|
| `esim.cancel` / `esim.list` / `esim.enable` / `esim.disable` / `esim.delete` / `esim.onboard_enter` / `esim.onboard_exit` | 10s |
| `esim.resp_begin` | 15s |
| `esim.data`（每块）| 30s |

> `esim.start` 仅表示「下载已启动」，**真正的下载完成要等异步事件 `esim.result`**，不要靠 `esim.start` 的同步响应判断成败。

---

## 3. 结果码约定

eSIM 结果码采用 GSMA `0x85000xxx` 系列。在协议中可能以**十进制数字**（如 `2231373524`）或**十六进制字符串**（如 `"0x85000704"` / `"85000704"`）两种形式出现，App 解析时需兼容。

- `0` = 成功（OK）；
- 非 0 = 失败，见下表（节选，完整表见 [附录 A](#附录-a-结果码全表)）。

| 码（hex）| 含义 |
|----------|------|
| `0` | OK |
| `85000004` | 操作超时 |
| `8500000f` | HTTPS 操作错误 |
| `85000010` | HTTPS 繁忙错误 |
| `85000017` | 数据等待超时 |
| `85000704` | 认证服务器错误：无会话上下文 |
| `85000909` | 安装失败：ICCID 已存在于 eSIM |
| `8500090a` | 安装失败：配置文件内存不足 |
| `85000101` | 启用失败：未发现 ICCID 或 AID |
| `85000201` | 禁用失败：未发现 ICCID 或 AID |
| `85000302` | 删除失败：配置文件已启用 |

错误响应示例（命令失败）：
```json
{ "c": "esim.enable", "e": 2231369217, "m": "profile not found" }
```

---

## 4. 命令清单（App → MCU）

| 命令 | 用途 | 有 `p` | 同步等待 |
|------|------|--------|----------|
| `esim.start` | 启动 profile 下载 | 是（`ac`）| 30s，但成败看 `esim.result` |
| `esim.cancel` | 取消正在进行的下载 | 否 | 10s |
| `esim.list` | 查询 profile 列表 | 否 | 10s |
| `esim.enable` | 启用某 profile | 是（`iccid`）| 10s |
| `esim.disable` | 禁用某 profile | 是（`iccid`）| 10s |
| `esim.delete` | 删除某 profile | 是（`iccid`）| 10s |
| `esim.onboard_enter` | 强制进入引导模式 | 否 | 10s |
| `esim.onboard_exit` | 强制退出引导模式 | 否 | 10s |
| `esim.resp_begin` | 通知 MCU「某次 HTTPS 响应体大小」（中转流程，见 §7）| 是 | 15s |
| `esim.data` | 向 MCU 上传一个 HTTPS 响应体分块（中转流程）| 是 | 30s/块 |

> `esim.resp_begin` / `esim.data` 仅在 HTTPS 中转流程中使用，普通 App 业务无需主动调用，详见 [§7](#7-https-中转下载流程)。

---

## 5. 事件清单（MCU → App）

| 事件 | 触发时机 | `r` 结构 |
|------|----------|----------|
| `esim.start`（同步响应特例）| `esim.start` 命令受理 | 数值：分块大小 `chunkLimit`（字节，>0 表示成功）|
| `esim.status` | 下载状态变化 | 字符串状态：`downloading` / `https` / `done` 等 |
| `esim.https_req` | 模组需要发起一次 HTTPS 请求，请 App 代发 | 对象：`{id, url, body, smdpAddress}` |
| `esim.data`（事件）| 数据块 ACK（中转流程中 MCU 确认收到某块）| 对象：`{id, offset}` 或结果码 |
| `esim.result` | 下载流程最终结果 | 对象 `{code}` 或裸数值结果码 |
| `esim.list` | profile 列表查询结果 | 对象 `{list: "<多行文本>"}` 或字符串 |
| `esim.enable` / `esim.disable` / `esim.delete`（事件）| 对应管理命令的最终结果 | 同结果码约定 |
| `esim-pending`（注意：无 `esim.` 前缀）| 设备处于引导模式，每 60s 重发提醒 | 对象 `{st: "no_profile"}` |

> 注意 `esim-pending` 用的是连字符而非点号，是历史命名，解析时单独处理。

---

## 6. 命令详解

### 6.1 `esim.start` — 启动下载

App 请求：
```json
{ "c": "esim.start", "p": { "ac": "LPA:1$smdp.example.com$MATCHING_ID" } }
```
- `ac`：LPA 激活码，格式 `LPA:1$<SMDP地址>$<匹配ID>`，UTF-8 不超过 **256 字节**。SMDP 地址会从中解析。

同步响应（成功，`r` 为分块大小）：
```json
{ "c": "esim.start", "r": 512 }
```
> `r > 0` 即下载已受理，`r` 值就是后续 HTTPS 中转时 App 上传分块的 `chunkLimit` 上限。**这只是「已启动」，最终成败要等 `esim.result`。**

同步响应（失败）：
```json
{ "c": "esim.start", "e": 2231369732 }
```

随后 App 将陆续收到：
- `esim.status` —— 状态变化；
- `esim.https_req` —— 需要中转的 HTTPS 请求（可能多次）；
- `esim.result` —— 最终结果（成功 `code=0`）。

> 启动前请确认：设备已连接、且大包 TRANSPORT 通道（`0000000e-...`）已订阅 CCCD Notify，否则大包回传会失败。

### 6.2 `esim.cancel` — 取消下载

App 请求：
```json
{ "c": "esim.cancel" }
```
同步响应：
```json
{ "c": "esim.cancel", "r": 0 }
```

### 6.3 `esim.list` — 查询 profile 列表

App 请求：
```json
{ "c": "esim.list" }
```

**方式一：同步响应**（部分固件直接在响应里返回）
```json
{ "c": "esim.list", "r": { "list": "<iccid>\",1,0,1,\"<name>\",\"<provider>\"\n..." } }
```

**方式二：异步事件**（推荐以事件为准）
```json
{ "e": "esim.list", "r": { "list": "..." } }
```

`r.list` 是一段 Quectel `+QESIM: "list"` 风格的多行文本，每行一个 profile，字段顺序为：
```
"<iccid>",<state>,<iconType>,<profileClass>,"<profileName>","<providerName>"
```
- `<state>`：`0` = 已禁用，`1` = 已启用。
- 其余字段参考 GSMA/Quectel 文档。

App 解析建议：按行切分，跳过 `+QESIM:` 与 `OK` 开头的行，用「带引号字符串 / 裸字段」正则切分逗号字段。

### 6.4 `esim.enable` / `esim.disable` / `esim.delete` — profile 管理

三者结构一致，仅命令名与限制不同。

App 请求：
```json
{ "c": "esim.enable",  "p": { "iccid": "8901410327111111111" } }
{ "c": "esim.disable", "p": { "iccid": "8901410327111111111" } }
{ "c": "esim.delete",  "p": { "iccid": "8901410327111111111" } }
```
- `iccid`：纯数字/字母字符串，App 侧应先做清洗（去除空格等非 `[0-9A-Za-z]` 字符）。

同步响应（成功）：
```json
{ "c": "esim.enable", "r": 0 }
```

最终结果以**异步事件**为准（事件名与命令名相同）：
```json
{ "e": "esim.enable", "r": { "code": 0 } }
```
> 删除已启用的 profile 会失败（`85000302`）；启用已启用的会失败（`85000102`）；禁用同理（`85000202`）。详见 [附录 A](#附录-a-结果码全表)。

### 6.5 `esim.onboard_enter` / `esim.onboard_exit` — 引导模式

详见 [eSIM 引导模式手动控制接口](esim_onboard_protocol_change.md)。

App 请求：
```json
{ "c": "esim.onboard_enter" }
{ "c": "esim.onboard_exit" }
```
同步响应（成功）：
```json
{ "c": "esim.onboard_enter", "r": 0 }
```
失败（例如当前有下载会话在跑）：
```json
{ "c": "esim.onboard_enter", "e": -16 }
```
`-16` = `-EBUSY`。引导模式下设备会周期性（约 60s）上报 `esim-pending` 事件提醒写卡。

---

## 7. HTTPS 中转下载流程

eSIM 下载的核心难点：模组需要和 SM-DP+ 做 HTTPS 通信（`authenticateClient`、`getBoundProfilePackage` 等），但模组无联网能力，必须由 App 代发请求、再把响应体分块喂回模组。

### 7.1 整体时序

```
App                          MCU/模组                       SM-DP+
 │                              │                              │
 │── esim.start {ac} ──────────▶│                              │
 │◀── {c:esim.start, r:chunk} ──│ (受理，chunk=分块上限)        │
 │                              │                              │
 │                              │  （下载中状态变化）           │
 │◀── e:esim.status r:"downloading" ──│                        │
 │                              │                              │
 │◀── e:esim.https_req {id,url,body,smdp} ──│                  │
 │                              │                              │
 │── POST /api/esim/https ────────────────────────────────────▶│
 │◀── HTTP 响应体(bytes) ──────────────────────────────────────│
 │                              │                              │
 │── esim.resp_begin {id,total} ▶│                             │
 │◀── {c:esim.resp_begin, r:0} ──│                             │
 │                              │                              │
 │  for offset in 0..total step chunk:                         │
 │── esim.data {id,offset,data} ▶│ (data=base64 分块)          │
 │◀── {c:esim.data, r:{id,offset:next}} ──│ (ACK，next>offset) │
 │                              │                              │
 │   ...（模组可能再发 https_req，重复上述）...                 │
 │                              │                              │
 │◀── e:esim.result {code:0} ────│ (最终结果)                  │
```

### 7.2 `esim.https_req` 事件（MCU → App）

模组请求 App 代发一次 HTTPS：
```json
{
  "e": "esim.https_req",
  "r": {
    "id": 1,
    "url": "https://smdp.example.com/oi/gsma/rsp2/es9plus/authenticateClient",
    "body": "<请求体，字符串，可能为空>",
    "smdpAddress": "smdp.example.com"
  }
}
```
| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 请求序号，后续 `resp_begin`/`data` 必须带上同一 `id` |
| `url` | string | 完整 HTTPS URL（已含协议） |
| `body` | string | 请求体（可能为 `""`），UTF-8 文本 |
| `smdpAddress` | string | SM-DP+ 地址（可选，中转代理路由用） |

> App 收到后应**幂等去重**：同一条 `https_req`（按 `id`+`url`+`body` 组合 key）可能因重发被收到多次，只应处理一次。

### 7.3 App 代发请求（HTTP 代理）

App 不直接连 SM-DP+，而是请求本地/配套服务的中转接口（App 自带或配套后端）：

```
POST /api/esim/https
Content-Type: application/json

{ "url": "<https_req.r.url>", "body": "<https_req.r.body>", "smdpAddress": "<https_req.r.smdpAddress>" }
```

响应体为**原始二进制字节流**（`application/octet-stream`，不要按 JSON 解析）。响应头里可能含调试信息（`X-Esim-HTTP-Status`、`X-Esim-HTTP-Content-Type`、`X-Esim-HTTP-Body-Bytes`、`X-Esim-HTTP-Response-Bytes`、`X-Esim-Resolved-URL`、`X-Esim-HTTP-Duration-Ms`），仅用于日志，不影响协议。

### 7.4 `esim.resp_begin` — 告知响应体总大小

拿到完整响应体后，先告知模组总字节数：
```json
{ "c": "esim.resp_begin", "p": { "id": 1, "total": 12345 } }
```
| 字段 | 说明 |
|------|------|
| `id` | 与 `https_req` 的 `id` 一致 |
| `total` | 响应体总字节数（≥0）|

同步响应（成功）：
```json
{ "c": "esim.resp_begin", "r": 0 }
```
- 若 `total = 0`（空响应体），`resp_begin` 成功后即可结束本次中转，**不必**再发 `esim.data`。

### 7.5 `esim.data` — 分块上传响应体

把响应体按 `chunkLimit`（`esim.start` 返回值，常见 512）切块，逐块上传：

App 请求：
```json
{
  "c": "esim.data",
  "p": { "id": 1, "offset": 0, "data": "SGVsbG8..." }
}
```
| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 与本次中转一致 |
| `offset` | number | 本块在响应体中的起始字节偏移 |
| `data` | string | 本块内容的 **Base64** 编码（标准 Base64，非 URL-safe） |

同步响应（ACK）：
```json
{ "c": "esim.data", "r": { "id": 1, "offset": 512 } }
```
- `r.offset`（或裸数值 `r`）= 模组**已确认收到的字节数**（即下一块应使用的 `offset`），必须 `> 当前 offset` 且 `≤ total`。
- App 用 ACK 里的 `offset` 作为下一块的起始偏移，**不要**自己累加 chunk 大小（模组可能合并/调整）。

分块规则：
- 块大小 `chunkLimit` 来自 `esim.start` 同步响应的 `r`；
- `chunk = bytes.subarray(offset, min(offset + chunkLimit, total))`；
- Base64 编码后体积会膨胀约 4/3，注意 BLE 大包通道能承载（已由 TRANSPORT 通道透明分片，业务层无需关心）。

错误情况：
- 若某块 ACK 返回错误响应（`{c:esim.data, e:<非0码>}`），本次中转失败，可发 `esim.cancel` 中止；
- 同步等待单块建议 30s。

### 7.6 收尾

- 全部分块 ACK 完毕后，模组会继续下载流程；可能再次发出 `esim.https_req`（下载往往需要多轮 HTTPS 往返），重复 §7.3–7.5。
- 下载**最终成败**只看 `esim.result` 事件：`code = 0` 成功，其余失败。

```json
{ "e": "esim.result", "r": { "code": 0 } }
```

---

## 8. 完整下载时序示例（成功路径）

```
→ {"c":"esim.start","p":{"ac":"LPA:1$smdp.example.com$ABC123"}}
← {"c":"esim.start","r":512}
← {"e":"esim.status","r":"downloading"}
← {"e":"esim.https_req","r":{"id":1,"url":"https://smdp.example.com/authenticateClient","body":"...","smdpAddress":"smdp.example.com"}}

   (App POST /api/esim/https，拿到 4096 字节响应体)

→ {"c":"esim.resp_begin","p":{"id":1,"total":4096}}
← {"c":"esim.resp_begin","r":0}
→ {"c":"esim.data","p":{"id":1,"offset":0,"data":"<base64>"}}
← {"c":"esim.data","r":{"id":1,"offset":512}}
→ {"c":"esim.data","p":{"id":1,"offset":512,"data":"<base64>"}}
← {"c":"esim.data","r":{"id":1,"offset":1024}}
   ... (一直循环到 offset=4096)

← {"e":"esim.https_req","r":{"id":2,"url":"...","body":"..."}}   // 第二轮 HTTPS
   (重复中转)

← {"e":"esim.result","r":{"code":0}}                              // 下载成功
```

---

## 9. App 实现要点 Checklist

- [ ] 接收缓冲 + 增量 JSON 解析（不可按通知边界切消息）。
- [ ] 命令响应判定：按 `c` 匹配，遇到错误响应（`c`+数值`e`）即视为响应到齐。
- [ ] 结果码兼容十进制数字与十六进制字符串两种形态。
- [ ] `esim.start` 返回的 `r` 保存为 `chunkLimit`，用于 `esim.data` 分块。
- [ ] HTTPS 中转：对 `esim.https_req` 按 `id+url+body` 去重，只处理一次。
- [ ] `esim.data` 下一块 offset 取自 ACK 的 `r.offset`，而非自行累加。
- [ ] `total=0` 时不发 `esim.data`。
- [ ] 下载最终成败只认 `esim.result`，不靠 `esim.start` 同步响应。
- [ ] ICCID 在发命令前清洗为 `[0-9A-Za-z]`。
- [ ] 引导模式相关：单独处理 `esim-pending`（连字符命名）事件。

---

## 附录 A. 结果码全表

| 码（hex）| 含义 |
|----------|------|
| `0` | OK |
| `85000001` | 存储错误 |
| `85000002` | 无效值错误 |
| `85000003` | 激活码错误 |
| `85000004` | 操作超时 |
| `85000005` | 通用错误 |
| `85000006` | 缓冲区溢出错误 |
| `85000007` | 操作错误 |
| `85000008` | 消息发送错误 |
| `85000009` | APDU 发送错误 |
| `8500000a` | APDU 状态错误 |
| `8500000b` | APDU 解析错误 |
| `8500000c` | TLV 解析错误 |
| `8500000d` | JSON 解析错误 |
| `8500000e` | 文件系统操作错误 |
| `8500000f` | HTTPS 操作错误 |
| `85000010` | HTTPS 繁忙错误 |
| `85000011` | 系统繁忙 |
| `85000012` | 获取 eUICC 信息 1 错误 |
| `85000013` | HTTPS 消息发送错误 |
| `85000014` | HTTPS 响应错误 |
| `85000015` | HTTPS 头错误 |
| `85000016` | SMDP 返回错误 |
| `85000017` | 数据等待超时 |
| `85000101` | 启用失败：未发现 ICCID 或 AID |
| `85000102` | 启用失败：配置文件已启用 |
| `85000103` | 启用失败：策略不允许 |
| `85000104` | 启用失败：重新启用配置文件时出错 |
| `85000105` | 启用失败：卡应用繁忙 |
| `8500017f` | 启用失败：未定义错误 |
| `85000201` | 禁用失败：未发现 ICCID 或 AID |
| `85000202` | 禁用失败：配置文件已禁用 |
| `85000203` | 禁用失败：策略不允许 |
| `85000204` | 禁用失败：卡应用繁忙 |
| `8500027f` | 禁用失败：未定义错误 |
| `85000301` | 删除失败：未发现 ICCID 或 AID |
| `85000302` | 删除失败：配置文件已启用 |
| `85000303` | 删除失败：策略不允许 |
| `8500037f` | 删除失败：未定义错误 |
| `85000401` | 列举失败：输入值不正确 |
| `8500047f` | 列举失败：未定义错误 |
| `85000501` | 别名定义错误：ICCID 未找到 |
| `8500057f` | 别名定义错误：未定义错误 |
| `85000601` | 通知错误：无内容可删除 |
| `8500067f` | 通知错误：未定义错误 |
| `85000701` | 认证服务器错误：无效证书 |
| `85000702` | 认证服务器错误：无效签名 |
| `85000703` | 认证服务器错误：不支持的曲线 |
| `85000704` | 认证服务器错误：无会话上下文 |
| `85000705` | 认证服务器错误：无效 OID |
| `85000706` | 认证服务器错误：eUICC Challenge 不匹配 |
| `85000707` | 认证服务器错误：CIPK 未知 |
| `8500077f` | 认证服务器错误：未定义错误 |
| `85000801` | 准备下载错误：无效证书 |
| `85000802` | 准备下载错误：无效签名 |
| `85000803` | 准备下载错误：不支持的曲线 |
| `85000804` | 准备下载错误：无会话上下文 |
| `85000805` | 准备下载错误：无效事务 ID |
| `8500087f` | 准备下载错误：未定义错误 |
| `85000901` | 安装失败：输入值不正确 |
| `85000902` | 安装失败：无效签名 |
| `85000903` | 安装失败：无效事务 ID |
| `85000904` | 安装失败：不支持的 CRT 值 |
| `85000905` | 安装失败：不支持的远程操作类型 |
| `85000906` | 安装失败：不支持的配置文件类别 |
| `85000907` | 安装失败：SECP03T 结构错误 |
| `85000908` | 安装失败：SECP03T 安全错误 |
| `85000909` | 安装失败：ICCID 已存在于 eSIM |
| `8500090a` | 安装失败：配置文件内存不足 |
| `8500090b` | 安装失败：操作中断 |
| `8500090c` | 安装失败：PE 处理错误 |
| `8500090d` | 安装失败：数据不匹配 |
| `8500090e` | 测试配置文件安装失败：无效的 NAA 密钥 |
| `8500090f` | 安装失败：不允许的 PPR |
| `8500097f` | 安装失败：未定义错误 |
| `85000a02` | 备用配置文件错误：配置文件已启用 |
| `85000a05` | 备用配置文件错误：卡应用忙碌 |
| `85000a06` | 备用配置文件错误：不可用 |
| `85000a07` | 备用配置文件错误：命令错误 |
| `85000a7f` | 备用配置文件错误：未定义错误 |
