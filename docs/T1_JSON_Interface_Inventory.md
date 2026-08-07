# T1 JSON 接口清单

> - 统计基线：`master` / `6227f5a2517c638e3fa356ea8794ec4f5e214070`，2026-07-30
> - 主入口：`src/application/dispatcher/command_parser.c`
> - 默认构建区域：`DEVICE_REGION=EU`

## 1. 范围与结论

- 当前 `RSP_FN` 共注册 **86 个 JSON 命令字符串**。
- 其中 11 个 `esim.*` 命令仅在 `DEVICE_REGION=EU` 下编译：
  - EU：86 个命令字符串，去掉别名后对应 82 个处理入口。
  - US：75 个命令字符串，去掉别名后对应 71 个处理入口。
- 别名组共 4 组：
  - `l` = `live.status`
  - `l1` = `live.on`
  - `l0` = `live.off`
  - `g` = `gnss.status`
- `dispatcher_file.c` 主体是二进制文件传输协议，不计入 86 个 JSON 命令；但它会产生一个 JSON 事件 `file-send-end`，因此收录在事件表。
- `dispatcher_sensor.c` 当前只有初始化入口，没有 JSON 命令或事件。

状态标记：

- **已接入**：存在于 `RSP_FN`，可被 `parse_json()` 路由。
- **EU 已接入**：仅 EU 构建存在。
- **内部/特殊**：已接入，但不是普通 APP 业务请求，或响应行为特殊。
- **调试/高风险**：已接入且会重启、关机、格式化、故意崩溃或执行原始 AT。
- **未接入**：存在处理代码，但没有加入当前路由表。

## 2. 通用报文约定

### 2.1 请求

```json
{"c":"命令名","p":{},"ts":1730000000}
```

- `c`：必填字符串。
- `p`：按命令定义，可省略、为标量、对象或数组。
- `ts`：可选；只有部分响应路径会回显，不能作为全局保证。
- `from`：不是外部协议字段。`parse_json()` 根据入口自动注入：
  - `0`：LTE/云端
  - `1`：BLE

### 2.2 响应

常见成功响应：

```json
{"c":"命令名","r":0}
```

常见失败响应：

```json
{"c":"命令名","e":-1}
```

带错误说明：

```json
{"c":"命令名","e":-1,"m":"错误说明"}
```

注意：

- `r` 的类型不固定，可能是数字、字符串、对象或数组。
- 部分旧接口把失败码放在 `r`，不是 `e`，表中单独注明。
- 未知 `c` 当前不会返回“未知命令”错误；`parse_json()` 仍返回 0，但不会产生任何响应。
- BLE 请求经 BLE notify 返回；LTE 请求经云端 response topic 返回。事件通常走 event topic，但个别事件固定只发 BLE。

## 3. 设备信息、电池与聚合状态

| 状态 | `c` | 请求 `p` / 特殊字段 | 成功响应 `r` | 说明 |
|---|---|---|---|---|
| 已接入 | `v` | 无 | 固件版本字符串 | 可选回显请求 `ts` |
| 已接入 | `b` | 无 | `{"v":电压mV,"c":电量百分比,"i":电流mA,"ch":充电状态}` | 读取缓存电池状态 |
| 已接入 | `nb` | 无 | 同 `b` | 先立即刷新一次电池状态 |
| 已接入 | `inf` | 无 | `{"id":IMEI,"mac":BLE地址,"icc":ICCID,"ime":IMEI,"sn":序列号,"model":型号,"dev":设备类型}` | 综合设备信息 |
| 已接入 | `id` | 无 | IMEI 字符串 | 旧短命令 |
| 已接入 | `mac` | 无 | BLE MAC 字符串 | 旧短命令 |
| 已接入 | `icc` | 无 | ICCID 字符串 | 旧短命令 |
| 已接入 | `ime` | 无 | IMEI 字符串 | 旧短命令 |
| 已接入 | `model` | 无 | 型号字符串 | 旧短命令 |
| 已接入 | `di` | 无 | `{"iccid":...,"imei":...,"v":固件版本,"sn":...}` | 与 `inf` 字段不完全一致 |
| 已接入 | `network.status` | 无 | `{"lte_state":N,"aws_state":N,"lte_qual":N,"rssi":dBm}` | 同步读取通信状态缓存 |
| 已接入 | `status` | 无 | 见下方 | 聚合状态 |
| 已接入 | `st` | 无 | Unix 时间戳数字 | RTC 无效时返回 `e:-1` |
| 内部/特殊 | `usage` | 不使用 `p`；读取顶层 `r:{"used":字节,"limit":字节}` | 无响应 | 云端下发的流量通知，只记录日志 |

`status` 的当前响应结构：

```json
{
  "c": "status",
  "r": {
    "b": {"c": 80, "ch": 0},
    "l": 0,
    "led": {"t": 0, "f": 0, "v": 0},
    "wifi": {"t": 2},
    "net": {"l": 3, "s": 1},
    "r": "固件版本",
    "gnss": {"s": 0, "q": 0, "f": 0}
  }
}
```

字段说明：

- `b.c`：电量百分比；`b.ch`：充电状态。
- `l`：Live 模式是否开启。
- `led.t/f/v`：LED 原始运行态枚举、周期、亮度。
- `wifi.t`：Wi-Fi 状态。
- `net.l`：LTE 信号等级；`net.s`：LTE 状态。
- 内层 `r`：固件版本。该命名与外层响应字段重名。
- `gnss.s/q/f`：GNSS 电源状态、信号等级、是否已定位。

## 4. GNSS、Live、功耗模式与吠叫检测

| 状态 | `c` | 请求 `p` / 特殊字段 | 成功响应 `r` | 说明 |
|---|---|---|---|---|
| 已接入 | `g` / `gnss.status` | 无 | `{"state":N,"last_loc"?:{"lat":度,"lng":度,"ts":秒},"fix_ts"?:秒,"qual":N,"cn0":[数量,top1..top8]}` | 两个命令完全同义 |
| 已接入 | `gnss.aid` | `{"ts":Unix秒,"lat":度,"lng":度}` | `0` | 同步 App 时间，并把位置注入 GNSS 点总线 |
| 已接入 | `agnss.check` | 无 | 调度器返回码 | 立即 kick AGNSS 调度 |
| 调试/高风险 | `agnss.clear` | 无 | 成功数减失败数；两个文件对应 `2/0/-2` | 删除双缓冲 PGL 文件，只清状态，不自动下载 |
| 已接入 | `l` / `live.status` | 无 | `{"e":0/1,"i":上报间隔秒,"r":剩余秒}` | `r.r` 为剩余时间 |
| 已接入 | `l1` / `live.on` | `{"v":分钟}` | `0` | 实际仅接受 `5/15/30/60`；家庭区域返回 `e:-2` |
| 已接入 | `l0` / `live.off` | 无 | `0` | 未开启时底层可能返回 `-EALREADY`，接口按错误返回 |
| 兼容接口 | `power_saving` | 无 `p` 为查询；设置时 `p` 为 `0/1` | 查询 `0/1`；设置成功 `0` | `0=DEFAULT`，`1=POWER_SAVING`；OTA 未确认可能 `r:-2`，eSIM pending 锁定可能 `r:-3` |
| 已接入 | `pm.mode` | 查询无 `p`；设置 `{"m":模式,"v"?:分钟}` | 查询为模式值；LIVE 查询额外顶层 `"v":剩余秒`；设置成功 `0` | `m`: 0 DEFAULT、1 BALANCED、2 POWER_SAVING、3 LIVE、4 ESIM_PENDING；4 只应查询 |
| 已接入 | `bk` | 查询无 `p`；设置 `p:0/1`；开启时可带顶层 `start/end` | 查询 `r:0`，或 `r:1,start:H,end:H`；设置成功 `0` | 时间为 UTC 小时，支持跨天，跨度必须 1~12h；省电模式下开启返回 `e:-2` |

## 5. 电子围栏

围栏对象：

```json
{
  "id": "fence-id",
  "fp": [
    {"type": 0, "center": [1.23, 4.56], "radius": 100},
    {"type": 1, "p": [1.23, 4.56, 1.24, 4.57, 1.25, 4.58]}
  ]
}
```

- `fp`：正向围栏数组；`fn`：反向围栏数组；至少存在一个。
- 每个 `fp`/`fn` 数组当前校验为 1~10 个基础围栏。
- `type=0`：圆形，`center=[lat,lng]`，`radius=0..10000` 米。
- `type=1`：多边形，`p=[lat,lng,...]` 为扁平坐标数组。
- `id` 非空且长度小于 32 字节。

| 状态 | `c` | 请求 `p` | 成功响应 `r` | 说明 |
|---|---|---|---|---|
| 已接入 | `fl` | 无 | 围栏 ID 字符串数组 | 从 `/lfs/fences/*.json` 枚举；响应总带 `ts`，缺失请求 `ts` 时序列化为 `null` |
| 已接入 | `fa` | 单个围栏对象，或 1~100 个围栏对象数组 | `0` | 新增或覆盖；数组模式先完整解析，再写入 |
| 已接入 | `fd` | 1~100 个围栏 ID 字符串数组 | `0` | 任一删除失败即返回错误；删除活动围栏会清活动态 |
| 已接入 | `fc` | 无 | `0` | 清空所有围栏并复位活动围栏 |
| 已接入 | `fe` | 无 | 当前活动围栏 ID 数组，最多 1 项 | 旧命名为 enabled list |
| 已接入 | `fe1` | `[围栏ID]`，必须恰好 1 项 | `0` | 加载并激活指定围栏 |
| 已接入 | `fe0` | `[围栏ID]`，必须恰好 1 项 | `0` | 仅能停用当前活动围栏 |

常见错误：

- `e:-2,m:"JSON校验失败"`
- `e:-3,m:"围栏解析失败"` 或 `"加载围栏失败"`
- `e:-1`：文件系统操作、重复状态或其他执行失败

## 6. LED

协议模式值：

- `0`：OFF
- `1`：STATIC
- `2`：BREATHE
- `3`：BLINK

参数：

- `f`：周期，单位 ms；BREATHE 底层要求至少 500ms，BLINK 至少 100ms。
- `v`：亮度百分比 `0..100`。
- `s`：仅 `sled.run` 使用；非 0 表示应用并保存。

| 状态 | `c` | 请求 `p` | 成功响应 `r` | 说明 |
|---|---|---|---|---|
| 已接入 | `sled.run` | `{"t":0..3,"f"?:ms,"v"?:0..100,"s"?:0/1}` | `0` | 立即应用；`s!=0` 时同时保存 |
| 已接入 | `sled.save` | `{"t":0..3,"f"?:ms,"v"?:0..100}` | `0` | 只保存，不改变当前运行态 |
| 已接入 | `sled.cfg` | 无 | `{"t":N,"f":ms,"v":百分比}` | 查询持久化配置 |
| 已接入 | `sled.status` | 无 | `{"t":N,"f":ms,"v":百分比}` | 查询运行态 |

## 7. Wi-Fi Tag

Wi-Fi 状态 `t`：

- `0`：已开启，当前没有匹配 AP。
- `1`：已开启，当前存在匹配 AP。
- `2`：已关闭。

Tag 对象：

```json
{"s":"SSID","m":"aa:bb:cc:dd:ee:ff","lat":12345678,"lng":123456789}
```

`lat/lng` 可选；当前实现按整数保存，未做范围校验。

| 状态 | `c` | 请求 `p` | 成功响应 `r` | 说明 |
|---|---|---|---|---|
| 已接入 | `wifi.status` | 无 | `{"t":0/1/2}`；`t=1` 时增加 `s/m/r` | `s` SSID，`m` MAC，`r` RSSI |
| 已接入 | `wifi.enable` | `{"f":扫描间隔秒,"l":丢失次数}` | `0` | `f>=30`，`l>=1` |
| 已接入 | `wifi.disable` | 无 | `0` | 清除最近 AP，并关闭扫描 |
| 已接入 | `wifi.scan` | 无 | 立即返回 `0` | AP 结果异步逐条发 `wifi-scan`；扫描中返回 `r:-1` |
| 已接入 | `wifi.addtag` | 单个 Tag 对象或非空 Tag 数组 | `0` | 同 MAC 覆盖；数组模式先在本地缓冲校验，全部通过后一次保存 |
| 已接入 | `wifi.deltag` | `{"m":"MAC"}` | `0` | 非法 MAC 返回 `r:2`；未找到返回 `e:-3` |
| 已接入 | `wifi.cleartags` | 无 | `0` | 只清 Tag，不改变扫描开关 |
| 已接入 | `wifi.querytag` | 无 | Tag 数组 | 每项为 `s/m/lat/lng` |

`wifi.addtag` 错误码：

- `e:-1`：Tag 容量已满。
- `e:-2`：参数或 MAC 格式非法。

## 8. 音频与告警 Profile

音量等级为 `0..15`；录音时长为 `1..60` 秒。

| 状态 | `c` | 请求 `p` | 成功响应 `r` / 事件 | 说明 |
|---|---|---|---|---|
| 已接入 | `audio.list` | 无 | 音频文件名数组 | 枚举 `/lfs/audios` |
| 已接入 | `audio.play` | `{"f":"文件名或路径","v":0..15}` | 同步 `r:0`；结束后 `sound-play-end` | 失败结束只记日志，不发结束事件 |
| 已接入 | `audio.crc` | 文件名字符串 | 小写十六进制 CRC32 字符串 | 文件固定从 `/lfs/audios/` 读取 |
| 已接入 | `audio.remove` | 文件名字符串数组 | `0` | 任一删除失败即返回错误 |
| 已接入 | `audio.record` | `{"f":"文件名","sec":1..60}` | 同步 `r:0`；结束后 `sound-record-end` | 录到 `/lfs/audios/` |
| 已接入 | `audio.record.stop` | 无 | `0` | 异步请求停止；最终仍以结束事件通知 |
| 已接入 | `audio.record.status` | 无 | `{"recording":bool,"file"?:...,"elapsed"?:秒,"max"?:秒}` | 非录音态只返回 `recording:false` |
| 已接入 | `ap` | Profile 索引数字 `0..4` | `{"a":{"path":"...","vol":0..15}}` | 查询 Profile |
| 已接入 | `ap.update` | `{"idx":0..4,"prf":Profile对象}` | `0` | 保存 Profile |
| 已接入 | `ap.exec_by_idx` | `{"idx":0..4}` | `0` | 播放已保存 Profile |
| 已接入 | `ap.exec_custom` | Profile 对象 | `0` | 播放临时 Profile，不保存 |

Profile 请求结构：

```json
{
  "a": {"path": "warning.wav", "vol": 10},
  "m": {"on": 1000, "off": 1000, "rep": 2}
}
```

当前 `m.on/off/rep` 会参与参数校验，但处理代码没有把它们保存到 Profile，也没有在执行时使用，详见风险章节。

## 9. eSIM（仅 EU）

以下命令和事件都受 `DEVICE_REGION=EU` 门控。eSIM App 事件固定发 BLE，不发云端。

| 状态 | `c` | 请求 `p` | 同步响应 | 异步最终结果 |
|---|---|---|---|---|
| EU 已接入 | `esim.start` | `{"ac":"激活码","cc"?:"确认码"}` | 成功 `r:512`，表示原始数据最大块 512 字节 | `esim.status`、`esim.https_req`、最终 `esim.result` |
| EU 已接入 | `esim.resp_begin` | `{"id"?:0..255,"total":响应体原始字节数}` | `r:0` 或 `e:<errno>` | 后续由 `esim.data` 分块推进 |
| EU 已接入 | `esim.data` | `{"id"?:0..255,"offset":原始字节偏移,"data":"Base64"}` | 受理成功时**无同步响应**；同步拒绝才返回 `e` | 每块经模组处理后发 `{"e":"esim.data","r":{"code":N,"offset"?:下一偏移}}` |
| EU 已接入 | `esim.cancel` | 无 | 始终 `r:0` | 下载会话终止；控制层返回值被忽略 |
| EU 已接入 | `esim.list` | 无 | 受理成功 `r:0` | `{"e":"esim.list","r":{"code":N,"list"?:原始模组字符串}}` |
| EU 已接入 | `esim.enable` | `{"iccid":"..."}` | 受理成功 `r:0` | `{"e":"esim.enable","r":{"code":N,...}}`；存在其他活动 profile 时拒绝热切换 |
| EU 已接入 | `esim.disable` | `{"iccid":"..."}` | 受理成功 `r:0` | `{"e":"esim.disable","r":{"code":N,...}}`；成功停用活动 profile 后安排重启 |
| EU 已接入 | `esim.delete` | `{"iccid":"..."}` | 受理成功 `r:0` | `{"e":"esim.delete","r":{"code":N,...}}` |
| EU 已接入 | `esim.pin_unlock` | `{"pin":"..."}` | 受理成功 `r:0` | `{"e":"esim.pin_unlock","r":{"code":N,"pin_state"?:...,"pin_retries"?:N,"puk_retries"?:N}}` |
| EU 已接入 | `esim.onboard_enter` | 无 | `r:0` 或 `e:<errno>` | 进入待写卡模式后主动发 `esim-pending`；有活动卡时先 disable，再重启 |
| EU 已接入 | `esim.onboard_exit` | 无 | `r:0` 或 `e:<errno>` | 没有独立 terminal event |

eSIM 事件字段的可选性：

- `esim.result.r.modem_code`：仅非空且不等于字符串 `"0"` 时存在。
- `esim.result.r.iccid`：仅非空时存在。
- `pin_retries/puk_retries`：仅查询成功、值不小于 0 时存在，APP 必须按可选字段处理。
- `esim.status.r` 当前可能为 `downloading`、`provisioned`、`enabling`、`disabling`、`unlocking`。
- `esim.list.r.list` 是模组原始字符串，不是结构化 JSON 数组。

## 10. DFU、系统与调试命令

| 状态 | `c` | 请求 `p` / 特殊字段 | 响应 | 影响 |
|---|---|---|---|---|
| 已接入 | `dfu.download` | `{"url":"HTTPS URL","timeout"?:秒}` | 调度受理成功 `r:0`，否则 `r:<负值>` | 只表示 OTA 调度器受理，不代表下载/升级完成 |
| 已接入 | `dfu.now` | 无 | 调度器返回码 | 立即请求检查版本并按需下载 |
| 调试/高风险 | `settings.format` | 无 | `r:0` 或 `e:<错误>` | 清空配置存储 |
| 内部/特殊 | `dir` | 目录名字符串 | 文件名数组 | 实际访问 `/lfs/<p>` |
| 内部/特殊 | `!` | 任意 | 无响应 | 当前处理函数为空 |
| 内部/特殊 | `sd` | 无 | `r:0` | 只把配置打印到日志 |
| 内部/特殊 | `?` | 无 | `{"f":...,"fid":...,"breach_width":...,"fence_sec":...,"rst":...}` | 输出围栏和复位原因摘要 |
| 调试/高风险 | `gnss` | 数字 | 无正常响应 | 当前 switch 没有有效 case，任何值都会进入 `FATAL()` |
| 内部/特殊 | `log` | 顶层 `m:"模块名",l:0..4`，不是 `p` | 无响应 | 仅 `CONFIG_LOG_RUNTIME_FILTERING` 开启时生效 |
| 调试/高风险 | `sec.format` | 无 | `r:0` 或 `e:<错误>` | 格式化外部 LittleFS |
| 内部/特殊 | `debug.event_gnss` | `{"type":N,"lat":度,"lng":度}` | 无响应 | 当前只记日志，实际事件注入已注释 |
| 调试/高风险 | `sys.reboot` | 无 | `r:0` | 1 秒后 warm reboot |
| 调试/高风险 | `sys.crash` | 无 | `r:0` | 1 秒后故意 HardFault |
| 调试/高风险 | `sys.hang` | 无 | `r:0` | 永久阻塞系统工作队列，等待 WDT |
| 调试/高风险 | `sys.poweroff` | 无 | `r:0` | 1 秒后进入 charger ship mode |
| 调试/高风险 | `atcmd` | `{"c":"原始命令"}` | 无即时响应；回调响应固定为 `{"c":"at","r":"..."}` | 走 factory AT parser，响应 `c` 不等于请求 `atcmd` |
| 调试/高风险 | `factory-reset` | 无 | 成功 `r:0`；部分失败 `e:<失败项数>,m:"失败项"` | 清围栏、自定义音频和配置，保留 3 个出厂音频，成功后 500ms cold reboot |

## 11. MCU 主动 JSON 事件

| 事件 `e` | 字段 | 通道/触发条件 |
|---|---|---|
| `battery` | 顶层 `charging_ind,v,c,t:[电池温度,IMU温度],ts` | 云端；电量达到 5% 步进且与上次不同 |
| `charging-started` | 顶层 `v,c,h,t:[...],ts` | 云端；`h` 为进水检测状态 |
| `charging-stopped` | 顶层 `v,c,t:[...],ts` | 云端 |
| `charging-completed` | 顶层 `v,c,t:[...],ts` | 云端 |
| `sled-consume` | 顶层 `c,ts` | 云端；LED 连续开启超过 3 分钟 |
| `wifi-scan` | `r:{"e":加密类型,"s":SSID,"m":MAC,"r":RSSI},ts` | 固定 BLE；`wifi.scan` 期间每匹配一个 AP 发一条 |
| `wifi-fix` | `r:{"s":SSID,"m":MAC,"r":RSSI},ts` | 云端；进入已配置 AP 区域 |
| `wifi-lost` | `r:{"s":SSID,"m":MAC,"r":RSSI},ts` | 云端；离开已配置 AP 区域 |
| `sound-play-end` | `r:{"f":"路径"},ts` | 跟随原请求来源；播放成功结束 |
| `sound-record-end` | `r:{"f":"文件名"},ts` | 跟随原请求来源；录音成功结束 |
| `file-send-end` | `r:{"h":句柄,"f":"文件名"},ts` | 跟随二进制文件读取请求来源 |
| `esim.https_req` | `r:{"id":N,"url":"...","body":"..."}` | EU、固定 BLE；App 代设备执行 HTTPS |
| `esim.data` | `r:{"code":N,"offset"?:下一偏移}` | EU、固定 BLE；`esim.data` 分块处理 ACK |
| `esim.result` | `r:{"code":N,"modem_code"?:字符串,"iccid"?:字符串}` | EU、固定 BLE；下载最终结果 |
| `esim.status` | `r:"状态字符串"` | EU、固定 BLE；eSIM 流程状态 |
| `esim.list` | `r:{"code":N,"list"?:原始字符串}` | EU、固定 BLE |
| `esim.enable` / `esim.disable` / `esim.delete` / `esim.pin_unlock` | `r:{"code":N,"pin_state"?:...,"pin_retries"?:N,"puk_retries"?:N}` | EU、固定 BLE；profile/PIN 命令最终结果 |
| `esim-pending` | `r:{"st":"no_profile"},ts` | EU、固定 BLE；无可用 profile，进入引导模式后立即发并每 60 秒提醒 |
| `esim.pin_required` | `r:{"pin_state":"...","pin_retries"?:N,"puk_retries"?:N},ts` | EU、固定 BLE；CPIN 非 READY，状态机周期复查 |

## 12. 已实现但当前未接入

| 处理入口 | 原计划命令 | 当前状态 |
|---|---|---|
| `rsp_settings_get()` | `settings.get` | 函数存在且标记 `__unused`，路由行已注释 |
| `rsp_settings_set()` | `settings.set` | 函数存在且标记 `__unused`，路由行已注释 |
| `rsp_fence_dump_active()` | `fencedump` / `debug.dump_active_fence` | 函数存在，两个路由名都已注释 |
| `rsp_run_at_cmd()` | `at` | 整段实现和路由都已注释，不参与编译 |
| 二进制 `audio.start` / `audio.data` | 命令类型 `0x04/0x05` | 只保留注释占位，未注册 |

## 13. 当前协议风险与不一致

| 优先级 | 问题 | 当前表现 | 建议 |
|---|---|---|---|
| 高 | 高风险调试命令无权限门禁 | `sys.crash/sys.hang/sec.format/settings.format/atcmd` 与普通命令共用同一路由表 | 量产构建增加编译门控或鉴权，至少限制为工厂/BLE 调试通道 |
| 高 | `fa` 单对象保存错误被忽略 | 单对象路径丢弃 `fence_force_save_json()` 返回值，仍可能回 `r:0`；数组路径会检查 | APP 暂不能把单对象 `r:0` 当作可靠落盘证明 |
| 高 | `pm.mode` 的无时限 LIVE 与注释不一致 | `p:{"m":3}` 只切 PM 用户模式，没有调用 `gps_live_mode_enable()`；只有带合法 `v` 才启动 3 秒 Live 调度 | 明确是否支持无限 LIVE；若不支持，强制要求 `v` |
| 中 | `live.on` 省略 `v` 实际失败 | handler 把缺省值传 0，但底层只接受 `5/15/30/60`；代码注释写“默认 10 分钟” | APP 必须显式传 `v`；后续统一旧接口和 `pm.mode` 约束 |
| 中 | `status.led.t` 与 `sled.*` 模式编号不一致 | `sled.*` 协议为 `2=BREATHE,3=BLINK`；聚合 `status` 直接返回底层枚举 `2=BLINK,3=BREATHE` | 聚合响应做协议枚举转换 |
| 中 | 告警 Profile 的 `m` 字段只有校验、没有行为 | `on/off/rep` 不保存、不返回、不执行 | APP 暂不要依赖该字段；确认需求后补齐数据结构和执行语义 |
| 中 | `wifi.scan` 异步事件固定走 BLE | 即使命令来自 LTE，AP 结果也调用 BLE response；扫描结束没有 completion event | 限定该命令只允许 BLE，或按 `from` 回源并补结束事件 |
| 中 | 未知命令无错误响应 | `parse_json()` 遍历未命中后仍返回 0 | 增加统一 `e:-ENOTSUP`，便于 APP/云端闭环 |
| 中 | 多边形参数校验不足 | 未强制坐标数组为偶数、至少 3 个点；奇数尾项会被静默忽略 | 协议层补偶数和最小顶点数校验 |
| 低 | 错误封装不统一 | 有的失败用 `e`，有的用 `r:-N`，`wifi.deltag` 非法 MAC 用 `r:2` | 新接口统一 `e/m`；旧接口先文档化兼容 |
| 低 | `ts` 回显不统一 | 一部分宏回显，一部分手工响应忽略；`fl` 无请求 `ts` 时仍发 `ts:0` | 不把 `ts` 回显作为通用契约，后续统一封装 |

## 14. 源码索引

- JSON 路由与大部分基础命令：`src/application/dispatcher/command_parser.c`
- 通用响应/事件发送：`src/application/dispatcher/dispatcher_internal.c/.h`
- 围栏：`src/application/dispatcher/dispatcher_fence.c`
- Wi-Fi：`src/application/dispatcher/dispatcher_wifi.c`
- 音频：`src/application/dispatcher/dispatcher_audio.c`
- 电池/充电事件：`src/application/dispatcher/dispatcher_pm.c`
- LTE 状态：`src/application/dispatcher/dispatcher_lte.c`
- LED 超时事件：`src/application/dispatcher/dispatcher_led.c`
- eSIM：`src/application/dispatcher/dispatcher_esim.c`
- 二进制文件传输及 JSON 完成事件：`src/application/dispatcher/dispatcher_file.c`
- 模块初始化接线：`src/application/dispatcher/dispatcher_service.c`
