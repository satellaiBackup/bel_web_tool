# S1 JSON 接口表

## 1. 文档范围

本文档根据 S1 固件 `src/application/dispatcher` 当前实现整理，覆盖：

- BLE APP 通道和 LTE/MQTT `/c` 下行的 JSON 命令；
- 设备主动产生的 JSON 事件；
- 条件编译、已注册但未实际接通的接口；
- 与 JSON dispatcher 相邻、但实际使用二进制帧的文件传输接口。

统计基线：

- 工程：`s1-52840`
- 分支：`USER_V1.0.1rc5`
- JSON 路由表：`src/application/dispatcher/command_parser.c`
- 当前构建实际注册：48 个命令字符串，合并别名后为 47 组接口
- 主动 JSON 事件：9 种

> 本文档描述代码行为，不代表已经完成 APP 联调、真实 NTN 网络或硬件验证。

## 2. 通用协议

### 2.1 请求格式

```json
{
  "c": "命令名",
  "p": "可选参数",
  "ts": 123456
}
```

字段说明：

| 字段 | 必选 | 说明 |
|---|---|---|
| `c` | 是 | 命令名称 |
| `p` | 否 | 命令参数，具体类型由命令定义 |
| `ts` | 否 | 请求标识或时间值；使用通用响应封装的命令会原样回显 |
| `from` | 否 | dispatcher 内部添加的来源字段，APP/云端不应传入 |

### 2.2 成功响应

```json
{
  "c": "命令名",
  "r": 0,
  "ts": 123456
}
```

`r` 可以是数字、字符串、对象或数组。

### 2.3 失败响应

```json
{
  "c": "命令名",
  "e": -1,
  "m": "可选错误信息",
  "ts": 123456
}
```

部分命令使用手工拼接响应，不一定回显 `ts`。

### 2.4 通道路由

| 请求来源 | 响应方向 |
|---|---|
| BLE APP 通道 | BLE APP notify |
| LTE/MQTT `/c` | MQTT response 通道 |

当前未知命令不会返回“未知命令”错误：`parse_json()` 找不到处理器后仍返回 0，调用方表现为收不到响应。

## 3. 设备信息与综合状态

| 命令 `c` | 参数 `p` | 成功返回 `r` | 说明 |
|---|---|---|---|
| `v` | 无 | 固件版本字符串 | 可回显请求 `ts` |
| `b` | 无 | `{v,c,i,ch}` | 当前缓存的电池状态 |
| `nb` | 无 | `{v,c,i,ch}` | 主动刷新一次电池状态后返回 |
| `inf` | 无 | `{id,mac,icc,ime,sn,model,nicc}` | 综合设备信息 |
| `id` | 无 | IMEI 字符串 | 当前实现中 `id` 使用 IMEI |
| `mac` | 无 | BLE MAC 字符串 |  |
| `icc` | 无 | LTE ICCID 字符串 |  |
| `nicc` | 无 | NTN ICCID 字符串 |  |
| `ime` | 无 | IMEI 字符串 |  |
| `model` | 无 | 设备型号字符串 |  |
| `di` | 无 | `{iccid,imei,v,sn}` | 另一组设备信息查询 |
| `network.status` | 无 | `{lte_state,aws_state,lte_qual,rssi}` | LTE/MQTT 状态和信号 |
| `net.cell` | 无 | `{cereg,cell,nwinfo,age_s}` | 模组网络原始信息及缓存年龄 |
| `env` | 无 | `0` 或 `1` | 查询环境：`0=生产`，`1=测试` |
| `env` | `0` 或 `1` | `0` | 设置设备环境 |
| `status` | 无 | 综合状态对象 | 聚合电池、LTE、版本、GNSS、NTN |

### 3.1 电池字段

```json
{
  "c": "b",
  "r": {
    "v": 4180,
    "c": 85,
    "i": -20,
    "ch": 0
  }
}
```

| 字段 | 说明 |
|---|---|
| `v` | 电池电压，mV |
| `c` | 电量百分比 |
| `i` | 电池电流，mA |
| `ch` | 充电状态 |

### 3.2 综合状态

```json
{
  "c": "status",
  "r": {
    "b": {
      "c": 80,
      "ch": 0
    },
    "net": {
      "l": 3,
      "s": 1
    },
    "r": "固件版本",
    "gnss": {
      "s": 1,
      "q": 35,
      "f": 1
    },
    "ntn": {
      "i": 10,
      "m": 0,
      "s": 2,
      "r": 1,
      "e": 0
    }
  }
}
```

## 4. 电源模式

| 命令 `c` | 参数 `p` | 返回/行为 | 说明 |
|---|---|---|---|
| `power_saving` | 无 | `0` 或 `1` | 查询旧省电开关 |
| `power_saving` | `0` | `0` | 切换到 NORMAL |
| `power_saving` | `1` | `0` | 切换到 POWER_SAVING |
| `pm.mode` | 无 | 当前模式值 | 统一模式查询 |
| `pm.mode` | `{"m":1}` | `0` | NORMAL/BALANCED |
| `pm.mode` | `{"m":5}` | `0` | NTN_ONLY |

`pm.mode` 仅接受 S1 当前支持的 `1` 和 `5`。常见错误：

| 错误 | 说明 |
|---|---|
| `-1` | 参数非法或模式不支持 |
| `-2` | OTA 镜像尚未 confirmed，拒绝模式切换 |
| `-EBUSY`，`m="busy"` | 通信会话繁忙 |

`power_saving` 是兼容旧 APP 的遗留接口，新实现应优先使用 `pm.mode`。

## 5. GNSS

| 命令 `c` | 参数 `p` | 成功返回/行为 | 说明 |
|---|---|---|---|
| `g` | 无 | GNSS 状态对象 | `gnss.status` 的短命令别名 |
| `gnss.status` | 无 | GNSS 状态对象 | 与 `g` 行为一致 |
| `gnss.aid` | `{"ts":UTC秒,"lat":纬度,"lng":经度}` | `0` | 更新 RTC 和辅助定位参考点 |

GNSS 状态示例：

```json
{
  "c": "gnss.status",
  "r": {
    "state": 1,
    "last_loc": {
      "lat": 22.543100,
      "lng": 114.057900,
      "ts": 1750000000
    },
    "fix_ts": 1750000000,
    "qual": 35,
    "cn0": [8, 45, 43, 41, 39, 38, 36, 34, 32]
  }
}
```

- `last_loc` 仅在存在历史位置时返回。
- `fix_ts` 仅在大于 0 时返回。
- `cn0[0]` 是卫星数量，后续 8 项是顶部卫星 C/N0。

## 6. NTN

| 命令 `c` | 参数 `p` | 成功返回/行为 | 说明 |
|---|---|---|---|
| `ntn.interval` | 无 | 当前间隔分钟数 | 查询最小 NTN 通信间隔 |
| `ntn.interval` | 正整数 | `0` | 设置最小 NTN 通信间隔 |
| `ntn.dbg` | 无 | `{data,ip,port}` | 最近 UDP 数据为 HEX；IP 已脱敏 |
| `ntn.status` | 无 | `{mode,state,ready,err}` | 查询同时会续期 NTN 等待窗口或触发注网 |
| `ntn.sms` | `{"id":0..65535,"payload":"Base64"}` | `{id,accepted:1}` | 提交 NTN 短信 |
| `ntn.test_lte` | 无 | `{en,cap,path}` | 查询 NTN-over-LTE 测试路径 |
| `ntn.test_lte` | `0` 或 `1` | `0` | `0=真实NTN`，`1=LTE模拟`；下个周期生效 |

### 6.1 NTN 短信

```json
{
  "c": "ntn.sms",
  "p": {
    "id": 100,
    "payload": "SGVsbG8="
  }
}
```

同步响应：

```json
{
  "c": "ntn.sms",
  "r": {
    "id": 100,
    "accepted": 1
  }
}
```

约束：

- `id` 为 `0..65535` 的整数。
- `payload` 必须为合法 Base64。
- Base64 解码后的原始数据长度为 `1..180` 字节。
- `accepted=1` 仅表示任务已受理；最终结果看 `ntn_sms_tx` 事件。

错误：

| 错误 | 消息 | 说明 |
|---|---|---|
| `-1` | `invalid_param` | 参数或 Base64 非法 |
| `-2` | `payload_too_long` | 解码失败、为空或超长 |
| `-3` | `ntn_not_ready` | NTN 未就绪 |
| `-4` | `ntn_busy` | NTN 会话繁忙 |
| `-5` | `internal_error` | 内部错误 |

当前已有构建配置启用了 `CONFIG_NTN_UDP_TEST_OVER_LTE`，因此 `ntn.test_lte` 具备写能力。发行固件若未编入该能力，设置操作会返回 `not_supported`。

## 7. 围栏

| 命令 `c` | 参数 `p` | 成功返回 `r` | 说明 |
|---|---|---|---|
| `fl` | 无 | 围栏 ID 数组 | 查询已保存围栏 |
| `fa` | 单个围栏对象 | `0` | 新增或覆盖围栏 |
| `fa` | 1～100 个围栏对象数组 | `0` | 批量新增或覆盖 |
| `fd` | `["id1","id2"]` | `0` | 批量删除围栏 |
| `fc` | 无 | `0` | 清空全部围栏并取消激活状态 |
| `fe` | 无 | 当前激活围栏 ID 数组 | 最多一个 |
| `fe1` | `["id"]` | `0` | 激活指定围栏 |
| `fe0` | `["id"]` | `0` | 停用指定围栏 |

### 7.1 围栏对象

```json
{
  "id": "home",
  "fp": [
    {
      "type": 0,
      "center": [22.5431, 114.0579],
      "radius": 500
    }
  ],
  "fn": [
    {
      "type": 1,
      "p": [
        22.1000, 114.1000,
        22.2000, 114.2000,
        22.3000, 114.3000
      ]
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 非空，长度小于 32 字节 |
| `fp` | 正向围栏数组 |
| `fn` | 反向围栏数组 |
| `type=0` | 圆形围栏 |
| `type=1` | 多边形围栏 |

`fp` 和 `fn` 至少存在一个。单个 `fp`/`fn` 数组最多包含 10 个子围栏。

圆形约束：

- `center=[lat,lng]`
- 纬度 `-90..90`
- 经度 `-180..180`
- 半径 `0..10000`

多边形使用扁平坐标数组：

```json
{"type":1,"p":[lat1,lng1,lat2,lng2,lat3,lng3]}
```

批量 `fa` 会先解析、校验全部对象；任一对象失败时不会进入保存阶段。

## 8. 系统、存储和 OTA

| 命令 `c` | 参数 `p` | 成功返回/行为 | 分类 |
|---|---|---|---|
| `st` | 无 | 当前 UTC 秒 | 查询 |
| `sd` | 无 | 打印配置到日志，返回 `0` | 调试 |
| `?` | 无 | `{f,fid,breach_width,fence_sec,rst}` | 调试 |
| `dir` | 目录名字符串 | `/lfs/<目录>` 下的文件名数组 | 调试/查询 |
| `settings.format` | 无 | 清空 Settings | 破坏性 |
| `sec.format` | 无 | 格式化外部 LittleFS | 破坏性 |
| `sys.reboot` | 无 | 返回 `0` 后延迟重启 | 系统控制 |
| `sys.poweroff` | 无 | 进入 ship mode | 系统控制 |
| `dfu.download` | `{"url":"...","timeout":秒}` | 提交 URL 下载，返回调度结果 | OTA |
| `dfu.now` | 无 | 立即请求固件检查 | OTA |
| `factory-reset` | 无 | 清配置、清围栏并冷重启 | 破坏性 |
| `usage` | 顶层 `r:{used,limit}` | 不回复，只记录流量日志 | 云端内部通知 |

`sys.poweroff` 在充电或外部电源接入时拒绝执行：

```json
{
  "c": "sys.poweroff",
  "e": -1,
  "m": "charging"
}
```

## 9. 已注册但不应作为正式接口

| 命令 `c` | 当前行为 | 结论 |
|---|---|---|
| `!` | 空函数，无响应 | 占位接口 |
| `gnss` | 数字参数进入没有有效 case 的 `FATAL()` | 危险调试残留 |
| `log` | 当前构建未启用运行时日志过滤，无动作、无响应 | 当前不可用 |
| `debug.event_gnss` | 仅打印参数，实际事件提交已注释，无响应 | 实现未接通 |

## 10. 主动事件

### 10.1 PM 和电池事件

| 事件 `e` | 字段 | 触发条件 | 通道 |
|---|---|---|---|
| `periodic-status` | `b,l,r,g,n,ts` | 正常 LTE 周期的预上报阶段 | 仅 MQTT |
| `battery` | `charging_ind,v,c,t,ts` | 电量变化到新的 5% 倍数 | Cloud event |
| `charging-started` | `v,c,h,t,ts` | 开始充电 | Cloud event |
| `charging-stopped` | `v,c,t,ts` | 停止充电 | Cloud event |
| `charging-completed` | `v,c,t,ts` | 充电完成 | Cloud event |

`periodic-status` 示例：

```json
{
  "e": "periodic-status",
  "b": 80,
  "l": 3,
  "r": -85,
  "g": 35,
  "n": 8,
  "ts": 1750000000
}
```

字段：

| 字段 | 说明 |
|---|---|
| `b` | 电量百分比 |
| `l` | LTE 信号等级 |
| `r` | LTE RSSI，dBm |
| `g` | GNSS 信号等级 |
| `n` | 卫星数量 |
| `ts` | UTC 秒 |

电池事件中的 `t` 当前为 `[电池温度,0]`。

### 10.2 NTN 事件

| 事件 `e` | 字段 | 说明 | 通道 |
|---|---|---|---|
| `ntn_state` | `state,ready,err,t,ts` | NTN 状态变化 | 仅 BLE |
| `ntn_sms_tx` | `id,state,err,t,ts` | NTN 短信发送状态 | 仅 BLE |
| `ntn_sms_rx` | `id,payload,len,t,ts` | 收到 NTN 短信 | 仅 BLE |

`ntn_sms_rx.payload` 是 Base64，`len` 是编码前的原始字节数。

### 10.3 文件发送结束事件

```json
{
  "e": "file-send-end",
  "r": {
    "h": 1,
    "f": "example.bin"
  },
  "ts": 1750000000
}
```

该事件由二进制文件读取流程产生，返回到原请求来源。

## 11. 条件编译和未接入项

| 项目 | 当前状态 |
|---|---|
| `settings.get` | 函数存在，命令路由已注释 |
| `settings.set` | 函数存在，命令路由已注释 |
| `fencedump` | 命令路由已注释 |
| `debug.dump_active_fence` | 命令路由已注释 |
| `at` | 旧 AT 透传实现整体注释 |
| `atcmd` | 受 `CONFIG_FACTORY_AT_TEST_FUNC_ENABLE` 控制；当前构建未开启 |
| `dispatcher_sensor` | 初始化为空，没有 JSON 命令或事件 |
| `dispatcher_lte_init` | 初始化为空；`network.status` 和 `net.cell` 由全局命令表直接注册 |

## 12. 二进制文件传输

`dispatcher_file` 不属于 JSON 命令协议，其帧格式为：

```text
[header:1B][cmd_type:1B][data_len:2B][data:NB]
```

当前命令：

| `cmd_type` | 名称 | 说明 |
|---|---|---|
| `0x01` | `file.info` | 发送文件信息 |
| `0x02` | `file.data` | 发送文件数据分包 |
| `0x03` | `file.query_map` | 查询接收位图 |
| `0x06` | `file.read_info` | 请求读取设备文件 |
| `0x07` | `file.resend` | 请求补发分包 |

文件传输完成后会产生 JSON `file-send-end` 事件。

## 13. 代码位置

| 内容 | 文件 |
|---|---|
| JSON 命令路由和通用命令 | `src/application/dispatcher/command_parser.c` |
| 响应和事件通道路由 | `src/application/dispatcher/dispatcher_internal.c` |
| PM/电池命令和事件 | `src/application/dispatcher/dispatcher_pm.c` |
| LTE 状态接口 | `src/application/dispatcher/dispatcher_lte.c` |
| 围栏接口 | `src/application/dispatcher/dispatcher_fence.c` |
| NTN 接口和事件 | `src/application/dispatcher/dispatcher_ntn.c` |
| 二进制文件传输 | `src/application/dispatcher/dispatcher_file.c` |
| 文件传输协议定义 | `src/application/dispatcher/dispatcher_file_protocol.h` |

