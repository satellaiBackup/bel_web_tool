# C1 Dock BLE Wi-Fi 配网调试页

## 协议基线

- 协议文档：`C1 Dock协议变更文档：BLE Wi-Fi 配网与 AWS 就绪链`（SAT-9，2026-08-06）
- 固件实现 commit：`849eafdf223750dd0799aa2a779b44b88c735324`
- 固件版本：`0.1.0-rc1`
- BLE 入口：SATELLAI Service `00000001-ffff-4fff-8fff-5a7e11a1ffff`
- APP Characteristic：`00000002-ffff-4fff-8fff-5a7e11a1ffff`
- 大包：TRANSPORT Characteristic `0000000e-ffff-4fff-8fff-5a7e11a1ffff`，逻辑 CH=3

工具不改变固件协议，复用现有 APP 通道、小包直写和大包 SAR 自动选择。

## 人工调试入口

“BLE 工具 → 调试工作台 → C1 Dock 配网”提供：

- `wifi.scan`：可编辑 `request_id`，展示 SSID/BSSID/RSSI/security/channel/attempt/sequence，并识别完成、取消和错误终态。
- `wifi.configure`：优先使用扫描事件的 `ssid_b64`；也允许输入可打印 `ssid`。支持 DHCP 和静态 IPv4/gateway/DNS。
- `wifi.cancel`：幂等取消当前 BLE owner 的活动 attempt。
- `wifi.provision.status`：在 BLE 重连或事件丢失后恢复 authoritative snapshot。
- `wifi-provision`：展示 `ASSOCIATING`、`WAIT_IP`、`WAIT_CLOUD`、`OPERATIONAL` 及结果码 0～19。

## 本地校验

发送前执行以下校验：

- `request_id` 最长 32 UTF-8 字节。
- `ssid_b64` 解码后 1～32 字节；文本 SSID 为 1～32 UTF-8 字节，两者只发送一个。
- 密码为空、8～63 字节，或 64 位十六进制 raw PSK。
- 静态 IPv4 的 prefix 为 1～30；地址、网关和 DNS 必须是单播地址；网关与 IPv4 同子网且不能是网段、广播或本机地址。

命令 ACK 只表示接受。扫描必须等待 `wifi-scan.done=true`；配网必须等待 `wifi-provision.done=true` 或查询状态确认。错误码 13～17 表示 AWS DNS/TCP/TLS/auth/subscribe 阶段的可恢复重试，不改写已经成功的 Wi-Fi/IP 状态。

## 日志与秘密

- C1 Dock 日志记录本机时间戳、方向、APP/TP 来源和完整接收 JSON。
- `wifi.configure.p.password` 在发送前生成独立的脱敏日志副本，固定记录为 `[REDACTED]`；真实值只进入当次 BLE 写入，不写 localStorage。
- 设备 `ts` 按当前协议显示为 uptime 毫秒，不解释为 Unix epoch。

## 已知限制与设备验证

- 代码测试和前端构建不等同于真实 Windows 蓝牙适配器/设备验证。
- 没有 YHM4101 且未启用 development-only assume-present 的镜像会按协议返回 `NOT_INSERTED`。
- LKG 当前为 RAM-only，不跨重启。
- 工具不配置或保存 AWS 证书、私钥及网络凭据。

## 验证命令

```powershell
go test ./...
npm --prefix frontend test
npm --prefix frontend run type-check
npm --prefix frontend run build
```
