# BLE 大包传输协议规范

版本：v1.0  
适用方：App 开发团队  
对应固件版本：v5.2.1+

---

## 1. 背景与目的

原有 4 个 BLE GATT 通道（APP / DFU / RTT / FILE）受 ATT MTU 限制，单次通知最多传输约 200 字节（iOS 实测，Android 因机型不同可能更大）。新增业务（WiFi 信标批量下发、eSIM 激活码中转等）消息体超出此限制，需要一种透明的分片/重组机制。

**新增第 5 个 GATT Characteristic（0x0000000E）专门承载大包**，所有通道共用这一条物理链路，通过帧头中的通道号区分。

App 侧感知到两种模式：
- **小包模式（≤ MTU-3 字节）**：照旧走原来的 4 个 Characteristic，行为不变。
- **大包模式（> MTU-3 字节）**：固件自动从大包 Characteristic 发出带帧头的分片；App 同样通过此 Characteristic 向固件发送大包。

---

## 2. GATT 服务结构

所有 Characteristic 使用相同的 128-bit UUID 基础，仅第 1 个字段（32-bit）不同：

| Characteristic | UUID（128-bit）                                      | 方向          | 用途                   |
|----------------|------------------------------------------------------|--------------|------------------------|
| APP            | `00000002-ffff-4fff-8fff-5a7e11a1ffff`               | Read/Write/Notify | JSON 指令/事件       |
| DFU            | `00000005-ffff-4fff-8fff-5a7e11a1ffff`               | Read/Write/Notify | TLV 固件升级           |
| RTT            | `00000008-ffff-4fff-8fff-5a7e11a1ffff`               | Read/Write/Notify | 实时 GNSS 轨迹         |
| FILE           | `0000000b-ffff-4fff-8fff-5a7e11a1ffff`               | Read/Write/Notify | 文件传输               |
| **TRANSPORT**  | **`0000000e-ffff-4fff-8fff-5a7e11a1ffff`**           | Read/Write/Notify | **大包传输（新增）**   |

> App 需要对 TRANSPORT Characteristic 开启 CCCD Notify 订阅。固件检测到 App 已订阅后，才会对超长消息启用大包路径；未订阅时自动降级为原路径（兼容旧版 App）。

---

## 3. 帧格式

每帧（PDU）长度 ≤ 协商 MTU − 3 字节（ATT 开销）。连接成功后 MCU 会主动发起 MTU 协商（目标 247B，iOS 实测约 244B，Android 可到 498B）。

### 3.1 基础帧头（所有帧共有，3 字节）

| 偏移 | 字节数 | 字段名   | 说明 |
|------|--------|----------|------|
| 0    | 1      | **CTRL** | 控制字节，见下方位定义 |
| 1    | 1      | **MSG_ID** | 消息标识，同一条 SDU 的所有分片 MSG_ID 相同；发送方每条消息递增（0→255→0 循环） |
| 2    | 1      | **SEQ**  | 分片序号，首片为 0，之后每帧 +1，mod 256 |

**CTRL 字节位定义：**

```
bit 7..6  版本号，当前恒为 0b00
bit 5     SOF（Start of Frame），1 = 本帧是消息的第一分片
bit 4     EOF（End of Frame），  1 = 本帧是消息的最后分片
bit 3..0  逻辑通道号（Channel ID）
```

当 SOF = EOF = 1 时，表示整条消息只有一帧（单帧消息）。

### 3.2 SOF 扩展头（仅首帧，额外 6 字节）

| 偏移（帧内） | 字节数 | 字段名       | 说明 |
|--------------|--------|--------------|------|
| 3            | 4      | **TOTAL_LEN** | 整条 SDU 的总字节数，小端序（Little Endian） |
| 7            | 2      | **CRC16**    | 整条 SDU 的 CRC16-CCITT 校验值，小端序。初始值 0xFFFF |

### 3.3 完整帧结构示意

**单帧消息（SOF=1, EOF=1）：**
```
+------+--------+-----+------------+-------+---------+
| CTRL | MSG_ID | SEQ | TOTAL_LEN  | CRC16 | PAYLOAD |
|  1B  |   1B   |  1B |    4B LE   | 2B LE |  ≤ N B  |
+------+--------+-----+------------+-------+---------+
       ←  基础头 3B  → ← SOF 扩展 6B → ← 数据 →
```

**多分片：首帧（SOF=1, EOF=0）：**
```
+------+--------+-----+------------+-------+---------+
| CTRL | MSG_ID | SEQ | TOTAL_LEN  | CRC16 | PAYLOAD |
| 0x2C |  N     |  0  |    4B LE   | 2B LE | CHUNK_0 |
+------+--------+-----+------------+-------+---------+
```
*注：0x2C = 0b00_1_0_1100，SOF=1，EOF=0，通道号=0xC（示例）*

**中间帧（SOF=0, EOF=0）：**
```
+------+--------+-----+---------+
| CTRL | MSG_ID | SEQ | PAYLOAD |
| 0x0C |  N     | 1,2 | CHUNK_X |
+------+--------+-----+---------+
```

**尾帧（SOF=0, EOF=1）：**
```
+------+--------+-----+---------+
| CTRL | MSG_ID | SEQ | PAYLOAD |
| 0x1C |  N     | K   | CHUNK_K |
+------+--------+-----+---------+
```

---

## 4. 逻辑通道表

| 通道号 | 名称       | 用途                                    |
|--------|------------|----------------------------------------|
| 0      | NUS        | Nordic UART Service（保留，未启用）     |
| 1      | DFU        | 固件升级（TLV 协议）                    |
| 2      | RTT        | 实时 GNSS 轨迹（Protobuf）              |
| 3      | APP        | JSON 指令 / 事件                        |
| 4      | FILE       | 文件传输（TLV 协议）                    |
| 5      | WIFI_CFG   | WiFi 信标批量下发（JSON 数组）          |
| 6      | ESIM       | eSIM 激活码 / LPA 中转数据             |
| 7–13   | —          | 预留                                    |
| 14     | ECHO       | 联调回环测试（收到即原样回传）          |
| 15     | CTRL       | 内部控制通道，ACK/NAK，**App 不直接使用** |

---

## 5. ACK/NAK 机制

接收方（MCU 或 App）每收完一条完整消息（无论成功或失败），必须通过控制通道（CH=15）回送一条单帧控制消息。

### ACK 帧格式

CTRL 字节 = `0x3F`（SOF=1, EOF=1, CH=15），后跟 6 字节 SOF 扩展头（TOTAL_LEN=3, CRC16 为 payload 的校验值），再后跟 3 字节 payload：

| 字节 | 字段     | 说明 |
|------|----------|------|
| 0    | 类型     | 固定为 `0x01`（ACK） |
| 1    | MSG_ID   | 被确认的那条消息的 MSG_ID |
| 2    | 状态码   | 见下表 |

| 状态码 | 含义           |
|--------|----------------|
| 0      | OK，成功       |
| 1      | CRC 校验失败   |
| 2      | 分片丢失/乱序  |
| 3      | 消息过长，拒收 |
| 4      | 内存不足       |
| 5      | 重组超时       |

> **App 实现要点：**
> - 发完每条大包消息后，等待 MCU 回送的 ACK（建议超时 5 秒）；
> - 状态码非 0 时整条消息重发；
> - MCU 发出的大包消息同理，App 收完重组后需回送 ACK。

---

## 6. 收发流程

### 6.1 App → MCU 发送大包

```
1. 计算 CRC16-CCITT (初始值 0xFFFF) 覆盖整个 payload
2. 计算每帧可用 payload 大小 = 协商MTU − 3 (ATT头) − 3 (基础帧头) − 6 (SOF扩展头，仅首帧)
3. 切片，按顺序 WRITE WITHOUT RESPONSE 写入 TRANSPORT Characteristic
4. 等待 MCU 在 TRANSPORT Characteristic 上 Notify 一条 CH=15 的 ACK
5. 若 ACK.status ≠ 0 或超时（5s），重发整条消息
```

### 6.2 MCU → App 接收大包（重组）

```
1. 订阅 TRANSPORT Characteristic Notify
2. 收到首帧（SOF=1）：
   - 读取 TOTAL_LEN，分配 buffer
   - 记录 MSG_ID、CRC16、期望 SEQ=0
3. 收到中间/尾帧（SOF=0）：
   - 校验 MSG_ID 和 SEQ 连续性（不连续丢弃整条，回送 NAK）
   - 追加 payload 到 buffer
4. 收到尾帧（EOF=1）：
   - 校验 buffer 总长 == TOTAL_LEN
   - CRC16-CCITT(buffer) == 帧中 CRC16
   - 校验通过 → 回送 ACK(status=0)，处理消息
   - 校验失败 → 回送 ACK(status=1 或 2)，丢弃 buffer
5. 重组超时（5 秒内未收到后续分片）→ 回送 ACK(status=5)，释放 buffer
```

---

## 7. 编码示例

以下示例为标准 C 语言（C99），不依赖任何平台 API，可直接移植到 iOS/Android NDK/Flutter FFI/Qt 等环境。  
BLE 写操作（`ble_write_without_response`）和定时器（`timer_*`）为平台接口占位，替换为对应平台 API 即可。

### 7.1 CRC16-CCITT

```c
#include <stdint.h>
#include <stddef.h>

uint16_t crc16_ccitt(const uint8_t *data, size_t len)
{
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (int j = 0; j < 8; j++) {
            crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : (crc << 1);
        }
    }
    return crc;
}
```

### 7.2 封包发送函数

```c
#include <stdint.h>
#include <stddef.h>
#include <string.h>

#define TP_CTRL_SOF  0x20
#define TP_CTRL_EOF  0x10

/* 平台接口：通过 TRANSPORT Characteristic 写一帧（Write Without Response） */
extern void ble_write_without_response(const uint8_t *data, uint16_t len);

/* 全局发送消息 ID，每条消息递增，mod 256 */
static uint8_t s_tx_msg_id = 0;

/**
 * 通过 TRANSPORT Characteristic 发送一条大包消息（自动分片）
 *
 * @param channel  逻辑通道号（见通道表，0~13）
 * @param payload  原始消息数据
 * @param pay_len  消息字节数（不超过 MCU 侧 MAX_SDU = 2048）
 * @param mtu      当前协商 MTU（平台回调中获取），即单次 Write 最大字节数
 */
void tp_send(uint8_t channel, const uint8_t *payload, uint32_t pay_len, uint16_t mtu)
{
    /* 分片帧缓冲：最大一帧 = MTU 字节 */
    uint8_t frame[512];  /* 按实际最大 MTU 调整，iOS 最大 244B */

    uint16_t crc       = crc16_ccitt(payload, pay_len);
    uint8_t  msg_id    = ++s_tx_msg_id;

    /* 首帧可用 payload 空间 = MTU - 基础头(3) - SOF扩展(6) */
    uint16_t first_max = mtu - 3 - 6;
    /* 后续帧可用 payload 空间 = MTU - 基础头(3) */
    uint16_t rest_max  = mtu - 3;

    uint32_t offset = 0;
    uint8_t  seq    = 0;

    while (offset < pay_len) {
        int      is_first = (seq == 0);
        uint16_t cap      = is_first ? first_max : rest_max;
        uint32_t chunk    = (pay_len - offset) < cap ? (pay_len - offset) : cap;
        int      is_last  = (offset + chunk == pay_len);

        uint16_t flen = 0;

        /* [0] CTRL */
        uint8_t ctrl = channel & 0x0F;
        if (is_first) ctrl |= TP_CTRL_SOF;
        if (is_last)  ctrl |= TP_CTRL_EOF;
        frame[flen++] = ctrl;

        /* [1] MSG_ID  [2] SEQ */
        frame[flen++] = msg_id;
        frame[flen++] = seq;

        /* SOF 扩展头（仅首帧） */
        if (is_first) {
            frame[flen++] = (uint8_t)(pay_len);
            frame[flen++] = (uint8_t)(pay_len >> 8);
            frame[flen++] = (uint8_t)(pay_len >> 16);
            frame[flen++] = (uint8_t)(pay_len >> 24);
            frame[flen++] = (uint8_t)(crc);
            frame[flen++] = (uint8_t)(crc >> 8);
        }

        /* PAYLOAD */
        memcpy(frame + flen, payload + offset, chunk);
        flen += (uint16_t)chunk;

        ble_write_without_response(frame, flen);

        offset += chunk;
        seq++;
    }
}
```

### 7.3 重组接收与 ACK 发送

```c
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* 平台接口 */
extern void ble_write_without_response(const uint8_t *data, uint16_t len);
extern void timer_start(int timeout_ms);   /* 启动/重置重组超时计时器 */
extern void timer_stop(void);

/* 消息分发（用户实现） */
extern void on_message(uint8_t channel, const uint8_t *data, uint32_t len);

/* 重组上下文（全局/单例） */
static struct {
    uint8_t  *buf;
    uint32_t  total;
    uint32_t  got;
    uint16_t  crc;
    uint8_t   msg_id;
    uint8_t   ch;
    uint8_t   next_seq;
    int       active;
} s_rx;

static void rx_reset(void)
{
    free(s_rx.buf);
    s_rx.buf    = NULL;
    s_rx.active = 0;
    timer_stop();
}

/* 构建并发送 ACK 帧（CH=15, SOF|EOF） */
static void send_ack(uint8_t msg_id, uint8_t status)
{
    uint8_t payload[3] = { 0x01, msg_id, status };
    uint16_t crc = crc16_ccitt(payload, 3);

    uint8_t frame[12] = {
        0x3F,                          /* CTRL: SOF|EOF|CH=15 */
        0x00,                          /* MSG_ID（控制帧填 0） */
        0x00,                          /* SEQ = 0 */
        0x03, 0x00, 0x00, 0x00,        /* TOTAL_LEN = 3 (LE) */
        (uint8_t)(crc),
        (uint8_t)(crc >> 8),
        payload[0], payload[1], payload[2],
    };
    ble_write_without_response(frame, sizeof(frame));
}

/**
 * 在 BLE Notify 回调中调用本函数，传入原始帧数据。
 *
 * @param data  Notify 数据指针
 * @param len   数据长度
 */
void tp_on_notify(const uint8_t *data, uint16_t len)
{
    if (len < 3) return;

    uint8_t ctrl   = data[0];
    uint8_t msg_id = data[1];
    uint8_t seq    = data[2];
    int     sof    = (ctrl & 0x20) != 0;
    int     eof    = (ctrl & 0x10) != 0;
    uint8_t ch     = ctrl & 0x0F;

    /* ── 控制帧（ACK）：CH=15，由发送侧等待逻辑处理 ── */
    if (ch == 0x0F) {
        /* ACK payload 在 data[9..11]: [0x01, msg_id, status] */
        if (len >= 12 && data[9] == 0x01) {
            tp_on_ack(data[10], data[11]);  /* 用户实现：唤醒等待 ACK 的线程/回调 */
        }
        return;
    }

    /* ── 单帧消息（SOF=1, EOF=1）── */
    if (sof && eof) {
        if (len < 9) return;
        uint32_t total = (uint32_t)data[3]
                       | (uint32_t)data[4] << 8
                       | (uint32_t)data[5] << 16
                       | (uint32_t)data[6] << 24;
        uint16_t crc   = (uint16_t)data[7] | (uint16_t)data[8] << 8;
        const uint8_t *pl = data + 9;
        uint32_t pl_len   = len - 9;

        if (pl_len != total)                    { send_ack(msg_id, 2); return; }
        if (crc16_ccitt(pl, pl_len) != crc)     { send_ack(msg_id, 1); return; }

        send_ack(msg_id, 0);
        on_message(ch, pl, pl_len);
        return;
    }

    /* ── 首帧（SOF=1, EOF=0）── */
    if (sof) {
        if (len < 9) return;

        rx_reset();  /* 丢弃可能残留的上一条 */

        uint32_t total = (uint32_t)data[3]
                       | (uint32_t)data[4] << 8
                       | (uint32_t)data[5] << 16
                       | (uint32_t)data[6] << 24;

        s_rx.buf = (uint8_t *)malloc(total);
        if (!s_rx.buf) { send_ack(msg_id, 4); return; }

        uint32_t pl_len = len - 9;
        memcpy(s_rx.buf, data + 9, pl_len);

        s_rx.total    = total;
        s_rx.got      = pl_len;
        s_rx.crc      = (uint16_t)data[7] | (uint16_t)data[8] << 8;
        s_rx.msg_id   = msg_id;
        s_rx.ch       = ch;
        s_rx.next_seq = 1;
        s_rx.active   = 1;

        timer_start(5000);
        return;
    }

    /* ── 中间帧 / 尾帧（SOF=0）── */
    if (!s_rx.active || msg_id != s_rx.msg_id || ch != s_rx.ch || seq != s_rx.next_seq) {
        rx_reset();
        send_ack(msg_id, 2);
        return;
    }

    uint32_t pl_len = len - 3;
    if (s_rx.got + pl_len > s_rx.total) { rx_reset(); send_ack(msg_id, 2); return; }

    memcpy(s_rx.buf + s_rx.got, data + 3, pl_len);
    s_rx.got += pl_len;
    s_rx.next_seq++;
    timer_start(5000);  /* 重置超时 */

    if (!eof) return;

    /* ── EOF：校验并分发 ── */
    timer_stop();

    if (s_rx.got != s_rx.total) {
        rx_reset(); send_ack(msg_id, 2); return;
    }
    if (crc16_ccitt(s_rx.buf, s_rx.total) != s_rx.crc) {
        rx_reset(); send_ack(msg_id, 1); return;
    }

    /* 取出引用后清空上下文，再分发，避免回调中再次进入 */
    uint8_t  *buf   = s_rx.buf;
    uint32_t  total = s_rx.total;
    uint8_t   fch   = s_rx.ch;
    s_rx.buf    = NULL;
    s_rx.active = 0;

    send_ack(msg_id, 0);
    on_message(fch, buf, total);
    free(buf);
}

/* 重组超时回调（由平台定时器触发） */
void tp_on_rx_timeout(void)
{
    uint8_t msg_id = s_rx.msg_id;
    rx_reset();
    send_ack(msg_id, 5);
}
```

### 7.4 等待 ACK（同步模式伪代码）

实际工程中，`tp_on_ack` 与发送侧需要同步。以下用信号量风格表示逻辑，平台替换为对应原语（pthread_cond / NSCondition / asyncio.Event 等）：

```c
#include <stdint.h>

/* 平台信号量（替换为实际实现） */
extern void sem_reset(void);
extern int  sem_wait_timeout(int ms);  /* 0=成功, -1=超时 */
extern void sem_post(void);

static volatile uint8_t s_ack_msg_id;
static volatile uint8_t s_ack_status;

/* 由 tp_on_notify → tp_on_ack 调用 */
void tp_on_ack(uint8_t msg_id, uint8_t status)
{
    s_ack_msg_id = msg_id;
    s_ack_status = status;
    sem_post();
}

/**
 * 发送大包并阻塞等待 MCU 的 ACK，带超时保护。
 *
 * @return  0      成功
 *          -1     超时（5s 内未收到 ACK）
 *          -2     MCU 返回 NAK（status != 0）
 */
int tp_send_and_wait(uint8_t channel, const uint8_t *payload,
                     uint32_t len, uint16_t mtu)
{
    sem_reset();
    tp_send(channel, payload, len, mtu);

    if (sem_wait_timeout(5000) != 0) {
        return -1;  /* 超时 */
    }
    return (s_ack_status == 0) ? 0 : -2;  /* 成功 / NAK */
}
```

---

## 8. 具体业务场景举例

### 8.1 App → MCU 下发 WiFi 信标列表（CH=5）

```json
[
  {"ssid": "Office_5G", "bssid": "AA:BB:CC:DD:EE:01", "rssi_threshold": -70},
  {"ssid": "Home_WiFi",  "bssid": "AA:BB:CC:DD:EE:02", "rssi_threshold": -75}
]
```

- 内容超过 200 字节时，走大包通道 CH=5 发送
- MCU 收到后回 ACK，再执行信标扫描

### 8.2 App → MCU eSIM 激活码（CH=6）

```
App 扫描二维码，得到激活码（如 200+ 字节的 LPA token）
  ↓
App 通过 CH=6 发送（tp_send_and_wait，等 ACK）
  ↓
MCU 收到 ACK 后透传给 LTE 模组
  ↓
LTE 模组组装 HTTPS 请求体（可超过 1KB）
  ↓
MCU 通过 CH=6 大包回传 HTTPS 响应体给 App
  ↓
App 发送实际 HTTPS 请求，收到响应再通过 CH=6 传回 MCU
```

### 8.3 联调回环测试（CH=14）

MCU 收到 CH=14 的消息后**原样 notify 回来**，适合 App 侧自测收发功能：

```c
/* 发送 1KB 全 0xAA 测试数据到 CH=14（ECHO） */
uint8_t test_data[1024];
memset(test_data, 0xAA, sizeof(test_data));

int ret = tp_send_and_wait(14, test_data, sizeof(test_data), current_mtu);
/* ret == 0: 期望随后 tp_on_notify 收到一条 CH=14 内容相同的大包 */
```

---

## 9. 注意事项

| 事项 | 说明 |
|------|------|
| **订阅顺序** | 连接后需先订阅 TRANSPORT Characteristic 的 CCCD，MCU 才会使用大包路径；否则 MCU 自动走原 Characteristic 小包路径。 |
| **MTU 协商** | MCU 连接后会主动发起 MTU 请求（目标 247B）。App 应在 MTU 更新回调后再发送大包，避免第一帧被截断。 |
| **并发限制** | 同一时刻链路上只允许一条**多分片**消息在途。App 发送方需等 ACK 返回后再发下一条大包（同步模式）。单帧消息（SOF=EOF=1）可以随时穿插，不受此限制。 |
| **SDU 上限** | 当前固件配置 MCU 侧单条 SDU 上限为 **2048 字节**（Kconfig `CONFIG_BLE_TRANSPORT_MAX_SDU`）。超过此大小发送时 MCU 回 NAK（status=3）。 |
| **MSG_ID 回绕** | MSG_ID 是 0~255 循环递增的无符号 8-bit 值，溢出正常。 |
| **SEQ 回绕** | SEQ 同样是 0~255 mod 256，分片超 256 片时 SEQ 循环。实际单条 2KB 消息在 MTU=244 时最多约 10 帧，不会触发。 |
| **旧版 App 兼容** | 未订阅 TRANSPORT Characteristic 的旧版 App 仍可正常使用，MCU 不会向未订阅端发送大包通知。 |

---

## 10. 快速接入 Checklist

- [ ] 扫描 Service UUID `00000001-ffff-4fff-8fff-5a7e11a1ffff`，找到 TRANSPORT Characteristic `0000000e-ffff-4fff-8fff-5a7e11a1ffff`
- [ ] 连接后订阅 TRANSPORT Characteristic CCCD（Enable Notify）
- [ ] 等待 MTU 协商完成回调，记录 `maxWriteLength`
- [ ] 实现 CRC16-CCITT（初始值 0xFFFF）
- [ ] 实现封包发送函数（见 §7.2）
- [ ] 实现重组接收状态机（见 §7.3）
- [ ] 实现 ACK 帧的发送与接收解析（见 §7.3 `sendACK`）
- [ ] 用 CH=14 ECHO 通道做端到端自测
