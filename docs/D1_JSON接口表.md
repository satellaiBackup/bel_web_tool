# D1 JSON 接口表

## 1. 统计口径

- 源码分支：`v15.2.1rc2`
- 源码版本：`df5f0f6`
- 统计日期：2026-07-30
- 主分发表：`src_9160/dispatcher/dispatcher.c` 中的 `RSP_FN[]`
- 分发入口：`parse_json()`，同时承接网络下行和 52840/BLE 转发
- 关联实现：
  - `src_9160/dispatcher/dispatcher_fence.c`
  - `src_9160/dispatcher/dispatcher_beacon.c`
  - `src_9160/dispatcher/dispatcher_audio_motor_shock.c`
  - `src_9160/dispatcher/dispatcher_gnss.c`
  - `src_9160/modules/Doggie_Talkie/dispatcher_audio.c`

当前共注册 **97 个命令字符串**，映射到 **73 个逻辑处理接口**；其中有 **24 个短命令/长命令别名**。`RSP_FN[]` 中相关模块均使用 `#if 1`，当前没有因条件编译关闭的注册项。

## 2. 通用协议约定

### 2.1 请求

```json
{
  "c": "命令字",
  "p": "命令参数，可选",
  "ts": 1730000000
}
```

| 字段 | 必选 | 类型 | 说明 |
| --- | --- | --- | --- |
| `c` | 是 | string | 命令字；缺失或非字符串时解析失败 |
| `p` | 否 | any | 参数，具体类型由各命令决定 |
| `ts` | 否 | number | 请求时间戳；多数响应会原样回传，少数自定义响应不回传 |
| `from` | 否 | number | 内部分发字段，由固件根据网络/BLE来源写入，外部调用方不应传入 |

### 2.2 标准响应

成功：

```json
{"c":"原命令字","r":0,"ts":1730000000}
```

失败：

```json
{"c":"原命令字","e":-1,"m":"错误说明","ts":1730000000}
```

说明：

- `r` 可能是 number、string、object 或 array。
- `e` 为错误码，`m` 仅在处理函数提供错误说明时出现。
- 响应默认回到请求来源：网络请求回网络，BLE 请求回 BLE。
- 未知 `c` 当前不会返回“不支持命令”错误；`parse_json()` 仍返回成功，但协议侧无响应。

## 3. 围栏接口

| 功能 | 命令 `c` | 请求参数 | 成功响应 `r` | 接入状态/备注 |
| --- | --- | --- | --- | --- |
| 查询总开关 | `f` / `fence.status` | 无 | `0` 或 `1` | 已接入 |
| 打开总开关 | `f1` / `fence.on` | 无 | `0` | 已接入；重置围栏事件状态 |
| 关闭总开关 | `f0` / `fence.off` | 无 | `0` | 已接入；重置围栏事件状态 |
| 查询已保存围栏 | `fl` / `fence.list` | 无 | `["id1","id2"]` | 已接入 |
| 新增/覆盖围栏 | `fa` / `fence.add` | `p=围栏对象`，或 `p=[围栏对象...]` | `0` | 已接入；批量数量 1~100，先全量解析再写入 |
| 删除围栏 | `fd` / `fence.del` | `p=["id1",...]` | `0` | 已接入；数组数量 1~100 |
| 清空围栏 | `fc` / `fence.clear` | 无 | `0` | 已接入；同时清除当前活动围栏 |
| 查询活动围栏 | `fe` / `fence.enabled_list` | 无 | `[]` 或 `["id"]` | 已接入；当前只支持一个活动围栏 |
| 激活围栏 | `fe1` / `fence.enable` | `p=["id"]` | `0` | 已接入；必须恰好一个 ID |
| 取消激活围栏 | `fe0` / `fence.disable` | `p=["id"]` | `0` | 已接入；必须与当前活动 ID 一致 |
| 打印活动围栏诊断 | `fencedump` / `debug.dump_active_fence` | 无 | 无 JSON 响应 | 已注册；只输出本地日志 |

围栏对象格式：

```json
{
  "id": "home",
  "fp": [
    {"type": 0, "center": [31.2304, 121.4737], "radius": 100},
    {"type": 1, "p": [31.1, 121.1, 31.2, 121.2, 31.3, 121.3]}
  ],
  "fn": [
    {"type": 0, "center": [31.2304, 121.4737], "radius": 10}
  ]
}
```

| 字段 | 约束 |
| --- | --- |
| `id` | 非空；新增时长度小于 32，删除/启停时长度不大于 32 |
| `fp` | 正向围栏数组；`fp`、`fn` 至少存在一个 |
| `fn` | 反向/排除围栏数组 |
| `fp[]` / `fn[]` | 每组 1~10 个基础围栏 |
| `type=0` | 圆形；`center=[lat,lng]`，纬度 -90~90，经度 -180~180，`radius` 0~10000 |
| `type=1` | 多边形；`p=[lat,lng,...]`，源码允许数组长度 0~100，当前未校验偶数长度和最少三个点 |

## 4. Beacon 接口

| 功能 | 命令 `c` | 请求参数 | 成功响应 `r` | 接入状态/备注 |
| --- | --- | --- | --- | --- |
| 查询总开关 | `k` / `beacon.status` | 无 | `0` 或 `1` | 已接入 |
| 打开总开关 | `k1` / `beacon.on` | 无 | `0` | 已接入 |
| 关闭总开关 | `k0` / `beacon.off` | 无 | `0` | 已接入 |
| 查询列表 | `kl` / `beacon.list` | 无 | `[{"id":"AABBCCDDEEFF","type":0,"state":1}]` | 已接入 |
| 新增 | `ka` / `beacon.add` | `p={"id":"12字符地址","type":number}` | `0` | 已接入；新增项默认启用 |
| 删除 | `kd` / `beacon.del` | `p="12字符地址"` | `0` | 已接入 |
| 启用单项 | `ke1` / `beacon.enable` | `p="12字符地址"` | `0` | 已接入 |
| 禁用单项 | `ke0` / `beacon.disable` | `p="12字符地址"` | `0` | 已接入 |
| 修改类型 | `kc` | `p={"id":"12字符地址","type":number}` | `0` | 已接入；没有长命令别名 |

## 5. 音频、马达和电击接口

### 5.1 文件与提醒配置

| 功能 | 命令 `c` | 请求参数 | 成功响应 `r` | 接入状态/备注 |
| --- | --- | --- | --- | --- |
| 查询音频文件 | `audio.list` | 无 | `["a.wav","b.wav"]` | 已接入；目录 `/lfs/audios` |
| 查询音频 SHA-256 | `audio.hash` | `p="文件名"` | 64 字符十六进制字符串 | 已接入 |
| 删除音频文件 | `audio.remove` | `p=["a.wav",...]` | `0` | 已接入 |
| 查询 APP 提醒配置 | `ap` | `p=索引` | 提醒配置对象 | 已接入；索引只能为整数 0~4 |
| 更新 APP 提醒配置 | `ap.update` | `p={"idx":0,"prf":提醒配置对象}` | `0` | 已接入；写入持久化配置 |
| 按索引执行提醒 | `ap.exec_by_idx` | `p={"idx":0}` | `0` | 已接入；索引只能为整数 0~4 |
| 执行临时提醒 | `ap.exec_custom` | `p=提醒配置对象` | `0` | 已接入；不持久化 |
| 查询/设置电击限额 | `shock_limit` | 查询不带 `p`；设置 `p={"max_count":n,"window_sec":n}` | 查询返回限额对象；设置返回 `0` | 已接入；非零 `max_count` 要求 `window_sec` 非零，未做上限校验 |

提醒配置对象：

```json
{
  "m": {"on": 200, "off": 200, "rep": 1},
  "s": {"freq": 500, "duty": 50, "dur": 500},
  "a": {"path": "warning.wav", "vol": 10}
}
```

| 字段 | 允许范围 |
| --- | --- |
| `m.on` / `m.off` | 0~5000 ms |
| `m.rep` | 0~3 |
| `s.freq` | 0~1000 |
| `s.duty` | 0~100 |
| `s.dur` | 0~1000 ms |
| `a.path` | string；源码未单独校验空指针/路径合法性 |
| `a.vol` | 0~15 |

### 5.2 播放与录音

| 功能 | 命令 `c` | 请求参数 | 立即响应 `r` | 后续结果 |
| --- | --- | --- | --- | --- |
| 播放音频 | `audio.play` | `p={"f":"文件路径","v":0~15}` | `0` | 成功播放结束后上报 `sound-play-end` |
| 开始录音 | `audio.record` | `p={"f":"文件名.wav","sec":1~60}` | `0` | 52840 回传并落盘成功后，上报 `sound-record-end` |
| 停止录音 | `audio.record.stop` | 无 | `0` | 最终完成仍由 `sound-record-end` 表示 |

## 6. GNSS 接口

| 功能 | 命令 `c` | 请求参数 | 成功响应 `r` | 接入状态/备注 |
| --- | --- | --- | --- | --- |
| 查询 GNSS 状态 | `g` / `gnss.status` | 无 | GNSS 状态对象 | 已接入 |
| 控制 GNSS | `gnss.ctrl` | `p=操作字符串` | `0` | 已接入 |
| 注入参考时间/位置 | `gnss.send_ref` | `p={"time":[...6项],"loc":[...7项]}` | `0` | 已接入；先发时间，再发位置 |
| 查询 C/N0 诊断 | `gnss.diag` | 无 | 9 个整数的数组 | 已接入 |
| 配置 NMEA 上传 | `gnss.nmea.upload` | `p={"indicator":n,"interval":n,"duration":n}` | `0` | 已接入；三个字段均可选，未校验数值范围；要求设备已取得 UTC |

`gnss.status` 响应：

```json
{
  "c": "gnss.status",
  "r": {
    "state": 1,
    "last_loc": {"lat": 31.2, "lng": 121.4, "ts": 1730000000},
    "fix_ts": 1730000000,
    "fixing": 1,
    "qual": 3,
    "cn0": [0,0,0,0,0,0,0,0,0]
  },
  "ts": 1730000000
}
```

- `state`：源码注释定义为 0=关机、1=开机、2=backup。
- `fix_ts`：仅非零时出现。
- `qual`：-1=模组异常，0=无可视卫星，1=差，2=一般，3=好，4=极好。
- `cn0`：实现实际返回 9 个元素。

`gnss.ctrl` 支持的操作字符串：

```text
power off
power on
power reset
enter backup mode
exit backup mode
hot start
warm start
cold start
full cold start
```

`gnss.send_ref` 数组顺序：

- `time=[year,month,day,hour,minute,second]`
- `loc=[lat,lng,height,major,minor,bearing,vertical]`

## 7. 设备状态、模式和配置接口

| 功能 | 命令 `c` | 请求参数 | 成功响应 `r` | 接入状态/备注 |
| --- | --- | --- | --- | --- |
| 查询固件版本 | `v` | 无 | 9160 版本字符串 | 已接入；9160/52840 版本不同时，顶层增加 `v52` |
| 查询电池 | `b` / `battery` | 无 | `{"v":电压,"c":电量,"ch":充电状态}` | 已接入；该自定义响应不回传 `ts` |
| 查询 Live Mode | `l` / `live.status` | 无 | 当前开关值 | 已接入 |
| 开启 Live Mode | `l1` / `live.on` | 无 | `0` | 已接入 |
| 关闭 Live Mode | `l0` / `live.off` | 无 | `0` | 已接入 |
| 查询网络状态 | `network.status` | 无 | 网络状态对象 | 已接入 |
| 配置 EPO 开关 | `epo.enable` | `p={"t":"类型","e":0或1}` | `0` | 已接入 |
| 查询 EPO 状态 | `epo.status` | `p="类型"` | EPO 状态对象 | 已接入 |
| 重置 EPO | `epo.reset` | 无，或 `p="time"` | `0` | 已接入；无 `p` 时清空全部并默认启用 GPS/BDS，`time` 只清周数和周内秒 |
| 查询/设置省电模式 | `power_saving` | 查询不带 `p`；设置 `p=0或1` | 查询返回当前值；设置返回 `0` | 已接入；开启时会关闭 Bark Detection |
| 查询/设置吠叫检测 | `bk` | 查询不带 `p`；设置 `p=0或1`，时间窗使用顶层 `start`/`end` | 查询返回 `0`，或顶层 `r=1,start,end`；设置返回 `0` | 已接入；与省电模式互斥，时间窗 1~12 小时 |
| 查询单项设置 | `settings.get` | `p="fence_inner_padding"` | 当前数值 | 已接入；目前只支持该 key |
| 设置单项设置 | `settings.set` | `p={"k":"fence_inner_padding","v":1~99}` | `0` | 已接入；目前只支持该 key |
| 查询目录文件 | `dir` | `p="相对目录"` | 文件名数组 | 已接入；实际访问 `/lfs/<p>` |
| 输出设置日志 | `sd` | 无 | `0` | 已接入；设置内容只打印到本地日志 |
| 查询设备信息 | `di` | 无 | 设备信息对象 | 已接入 |

`network.status` 的 `r`：

```json
{
  "lte_state": 1,
  "aws_state": 1,
  "lte_qual": 3,
  "modem_cesq": {"rsrq": 20, "rsrp": 70}
}
```

`lte_qual` 和 `modem_cesq` 仅在 `modem_cesq()` 成功时出现。

`epo.enable` / `epo.status` 支持的类型：`gps`、`galileo`、`bds`、`gps_glonass`。

`epo.status` 的 `r`：

```json
{
  "update": 0,
  "status": 0,
  "enable": 1,
  "week_number": 0,
  "time_of_week": 0
}
```

`di` 的 `r`：

```json
{
  "iccid": "",
  "imei": "",
  "imsi": "",
  "v9": "9160版本",
  "v5": "52840版本",
  "mac": "52840地址",
  "vg": "GNSS版本",
  "sn": "序列号",
  "model": "设备型号"
}
```

## 8. 用量统计接口

| 功能 | 命令 `c` | 请求参数 | 成功响应 `r` | 接入状态/备注 |
| --- | --- | --- | --- | --- |
| 查询统计 | `usage.stats` | 可选 `p="sys"` / `"network"` / `"gnss"` / `"battery"` | 统计对象 | 已接入；不带 `p` 返回全部 |
| 清空统计 | `usage.stats.clear` | 无 | `usage_stats_clear()` 返回值 | 已接入；即使底层返回负值，也被放在成功字段 `r` 中 |
| 查询/设置用量日志开关 | `usage.log.enabled` | 查询不带 `p`；设置 `p=0或1` | 查询返回当前值；设置返回 `0` | 已接入 |
| 清空用量日志 | `usage.log.clear` | 无 | `0` | 已接入 |
| 接收流量用量结果 | `usage` | `r={"used":字节数,"limit":字节数}` | 无 JSON 响应 | 已注册；这是设备接收的结果消息，不是请求/响应命令 |

`usage.stats` 完整返回对象：

```json
{
  "t": 1234,
  "sys": {
    "sr": [reset总数, 硬件复位, 看门狗复位, 软件复位, 其他复位]
  },
  "network": {
    "lte": {"l1":0,"l0":0,"l1ct":0,"l1it":0},
    "aws": {
      "a1":0,
      "a0":0,
      "a1t":0,
      "af":[失败总数,DNS,MQTT,拒绝,TIMEOUT_11,TIMEOUT_116,未知],
      "ac":[root证书,device证书,private key]
    }
  },
  "gnss": {"g1":0,"g0":0,"g1t":0,"gf":0,"gl":0,"gt":0},
  "battery": {"bc":0}
}
```

## 9. 系统、运维和调试接口

| 功能 | 命令 `c` | 请求参数 | 成功响应 | 接入状态/风险 |
| --- | --- | --- | --- | --- |
| 空白自定义入口 | `!` | 任意 | 无 | 已注册但处理函数为空 |
| 查询运行态汇总 | `?` | 无 | `r={"fix","f","fid","breach_width","fence_sec","bv","bat_cap","ch","uptime","rst"}` | 已接入；调试用途 |
| 设置运行时日志级别 | `log` | 顶层 `m=模块名,l=0~4` | 无 JSON 响应 | 仅 `CONFIG_LOG_RUNTIME_FILTERING` 开启时生效 |
| 格式化外部 Flash | `sec.format` | 无 | `r=0` 或 `e=错误码` | 高风险破坏性接口 |
| 设置 LTE 自动重连 | `lte.auto_reconnect` | `p=number` | `0` | 已接入；未限制为 0/1 |
| 透传 AT 命令 | `at` | `p="AT命令"` | `{"c":"AT命令本身","r":"模组响应"}` | 已接入；响应 `c` 不是 `"at"` |
| 设置调试参数 | `debug.set` | `p="参数名"`，顶层 `v=number` | `0` | 支持 `mem_thread_check_interval`、`modem_diag_interval` |
| 输出日志文件到 52840 | `log.cat` | `p="文件路径"` | `0` | 文件内容经 TLV 发送，不在 JSON 响应中 |
| 发起网络下载 | `dl` | `p="URL"` | 无 JSON 响应 | 已注册；下载进度/结果仅写日志 |
| 分段读取文件 | `debug.file` | `p="文件路径"` | 多段 JSON | 已接入；见下方多段响应 |
| 注入 GNSS 事件 | `debug.event_gnss` | `p={"type":n,"lat":n,"lng":n}` | 无 JSON 响应 | 已注册；未做字段类型/空值校验 |
| 重启系统 | `sys.reboot` | 可选 `p=0/1/2` | 先返回 `0`，1 秒后执行 | `0`=9160，`1`=52840，`2`=两颗芯片；其他值会触发 `FATAL()` |
| 进入运输/关机模式 | `sys.poweroff` | 无 | 先返回 `0`，1 秒后执行 | 调用充电芯片 ship mode |
| HTTP DFU | `dfu` | `p={"host":"主机","file":"路径","device_type":"9160"}` | `0` | 只支持 9160；52840 返回 `-2` |
| 触发实时传感器读取 | `debug.sensor_rt` | 无 | 无 JSON 响应 | 已注册；仅触发 `sensor_imu_data_fetch()` |
| 恢复出厂设置 | `factory-reset` | 无 | `0` 后重启 | 会重置设置、删除非出厂音频、清空围栏 |

`debug.file` 多段响应：

```json
{"c":"debug.file","file":"/lfs/example","size":1234}
{"c":"debug.file","o":150,"r":"Base64分片"}
{"c":"debug.file","file":"/lfs/example","sha256":"64字符十六进制","ts":1730000000}
```

DFU 每增加 5% 会向网络侧额外上报：

```json
{"r":"dfu","p":"5%","ts":1730000000}
```

## 10. 异步事件

这些事件不是 `RSP_FN[]` 中可调用的命令，但由已注册接口的后续流程直接产生。

| 事件 `e` | 触发源 | JSON 结构 | 上报目标 |
| --- | --- | --- | --- |
| `sound-play-end` | `audio.play` 播放成功结束 | `{"e":"sound-play-end","r":{"f":"文件路径"},"ts":...}` | 跟随原始请求来源：BLE 或网络 |
| `sound-record-end` | `audio.record` 文件接收成功 | `{"e":"sound-record-end","r":{"f":"文件名"},"ts":...}` | 仅网络 |
| 无 `e`，`r="dfu"` | `dfu` 下载进度每变化 5% | `{"r":"dfu","p":"NN%","ts":...}` | 仅网络 |

## 11. 接入状态汇总

| 类别 | 数量 | 说明 |
| --- | ---: | --- |
| 注册命令字符串 | 97 | 包含短命令和长命令别名 |
| 逻辑处理接口 | 73 | 按唯一 handler 统计 |
| 已实现但未注册的 JSON handler | 0 | 未发现游离的命令处理函数 |
| 已注册但无直接 JSON 响应 | 7 | `!`、`fencedump/debug.dump_active_fence`、`log`、`dl`、`debug.event_gnss`、`usage`、`debug.sensor_rt` |
| 空实现 | 1 | `!` |

## 12. 代码现状风险

以下是接口盘点时发现的现状，不代表本次文档修改了这些行为：

1. 未知命令不返回错误，调用方只能靠超时判断。
2. `settings.get` 在 `p` 非字符串时发送错误后未立即返回，仍可能继续访问无效参数。
3. `dfu` 对 `host`、`file`、`device_type` 的空值检查误用了 `p`，字段缺失时存在空指针风险。
4. `dfu_start()` 失败时会先发送错误响应，随后仍继续发送成功响应。
5. `factory-reset` 的分步失败没有中止流程，可能发送一个或多个错误响应后仍发送成功并重启。
6. `debug.file` 打开文件失败时只记日志，不返回协议错误。
7. 多边形围栏未校验点数组必须为偶数长度，也未要求至少三个点。
8. `audio.record` 的完成事件固定发网络侧，即使命令来自 BLE。
