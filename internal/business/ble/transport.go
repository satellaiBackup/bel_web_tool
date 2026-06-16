package ble

import (
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"sync"
	"time"

	"tinygo.org/x/bluetooth"
)

const (
	uuidSvcSatellai = "00000001-ffff-4fff-8fff-5a7e11a1ffff"
	uuidCharApp     = "00000002-ffff-4fff-8fff-5a7e11a1ffff"
	uuidCharDfu     = "00000005-ffff-4fff-8fff-5a7e11a1ffff"
	uuidCharRtt     = "00000008-ffff-4fff-8fff-5a7e11a1ffff"
	uuidCharFile    = "0000000b-ffff-4fff-8fff-5a7e11a1ffff"
	uuidCharTP      = "0000000e-ffff-4fff-8fff-5a7e11a1ffff"

	tpCtrlSOF = 0x20
	tpCtrlEOF = 0x10
	tpChCtrl  = 0x0f

	tpAckType       = 0x01
	tpAckOK         = 0x00
	tpAckCRC        = 0x01
	tpAckSeq        = 0x02
	tpAckTooLong    = 0x03
	tpAckNoMem      = 0x04
	tpAckTimeout    = 0x05
	tpAckWait       = 5 * time.Second
	tpMaxSendRetry  = 2
	tpMaxReceiveSDU = 2048
)

var (
	errTransportUnavailable = errors.New("设备未开放大包传输特征")
	errTransportNoACK       = errors.New("等待大包 ACK 超时")
)

var charToTransportChannel = map[string]byte{
	uuidCharDfu:  1,
	uuidCharRtt:  2,
	uuidCharApp:  3,
	uuidCharFile: 4,
}

var transportChannelToChar = map[byte]string{
	1: uuidCharDfu,
	2: uuidCharRtt,
	3: uuidCharApp,
	4: uuidCharFile,
}

type bleTransportState struct {
	mu      sync.Mutex
	txMsgID byte
	pending map[byte]chan byte
	rx      *bleTransportRx
}

type bleTransportRx struct {
	buf     []byte
	total   uint32
	got     uint32
	crc     uint16
	msgID   byte
	channel byte
	nextSeq byte
}

func newBLETransportState() *bleTransportState {
	return &bleTransportState{
		pending: make(map[byte]chan byte),
	}
}

func (m *bleManager) writeCharacteristicAuto(serviceUUID, characteristicUUID string, payload []byte, transportChannel *int) error {
	normalizedServiceUUID, err := normalizeUUID(serviceUUID)
	if err != nil {
		return err
	}
	normalizedCharUUID, err := normalizeUUID(characteristicUUID)
	if err != nil {
		return err
	}

	conn, err := m.requireConnection()
	if err != nil {
		return err
	}
	if err := m.waitForConnectionReady(conn); err != nil {
		return err
	}

	if transportChannel != nil && (*transportChannel < 0 || *transportChannel >= int(tpChCtrl)) {
		return fmt.Errorf("transportChannel 必须在 0~14 之间")
	}

	conn.opMu.Lock()
	defer conn.opMu.Unlock()

	char, key, err := m.getCharacteristicLocked(conn, normalizedServiceUUID, normalizedCharUUID)
	if err != nil {
		return err
	}

	if transportChannel != nil {
		return m.writeTransportLocked(conn, byte(*transportChannel), payload)
	}

	smallLimit := characteristicPayloadLimit(char)
	channel, supportsTransport := charToTransportChannel[normalizedCharUUID]
	if !supportsTransport || normalizedServiceUUID != uuidSvcSatellai || len(payload) <= smallLimit {
		return writeBLECharacteristic(char, key, payload)
	}

	return m.writeTransportLocked(conn, channel, payload)
}

func (m *bleManager) writeTransportLocked(conn *bleConnection, channel byte, payload []byte) error {
	if len(payload) > tpMaxReceiveSDU {
		return fmt.Errorf("大包数据长度 %d 超过设备上限 %d 字节", len(payload), tpMaxReceiveSDU)
	}

	tpChar, tpKey, err := m.ensureTransportNotificationsLocked(conn)
	if err != nil {
		return err
	}

	frameLimit := characteristicPayloadLimit(tpChar)
	if frameLimit < 12 {
		return fmt.Errorf("当前大包特征可写字节数过小: %d", frameLimit)
	}

	var lastErr error
	for attempt := 0; attempt <= tpMaxSendRetry; attempt += 1 {
		msgID := conn.transport.nextMsgID()
		ackCh := conn.transport.registerPending(msgID)
		frames := buildTransportFrames(channel, msgID, payload, frameLimit)

		lastErr = nil
		for _, frame := range frames {
			if err := writeBLECharacteristic(tpChar, tpKey, frame); err != nil {
				lastErr = err
				break
			}
		}
		if lastErr != nil {
			conn.transport.clearPending(msgID)
			continue
		}

		select {
		case status := <-ackCh:
			conn.transport.clearPending(msgID)
			if status == tpAckOK {
				return nil
			}
			lastErr = fmt.Errorf("设备返回大包 NAK: status=%d", status)
		case <-time.After(tpAckWait):
			conn.transport.clearPending(msgID)
			lastErr = errTransportNoACK
		}
	}

	return lastErr
}

func (m *bleManager) ensureTransportNotificationsLocked(conn *bleConnection) (bluetooth.DeviceCharacteristic, string, error) {
	tpChar, tpKey, err := m.getCharacteristicLocked(conn, uuidSvcSatellai, uuidCharTP)
	if err != nil {
		return bluetooth.DeviceCharacteristic{}, "", fmt.Errorf("%w: %v", errTransportUnavailable, err)
	}
	if conn.notifyState[tpKey] {
		return tpChar, tpKey, nil
	}

	if err := m.enableNotificationsLocked(conn, uuidSvcSatellai, uuidCharTP); err != nil {
		return bluetooth.DeviceCharacteristic{}, "", err
	}
	return tpChar, tpKey, nil
}

func (m *bleManager) handleTransportNotification(conn *bleConnection, tpChar bluetooth.DeviceCharacteristic, data []byte) bool {
	if len(data) < 3 {
		return true
	}

	ctrl := data[0]
	msgID := data[1]
	seq := data[2]
	sof := ctrl&tpCtrlSOF != 0
	eof := ctrl&tpCtrlEOF != 0
	channel := ctrl & 0x0f

	if channel == tpChCtrl {
		if len(data) >= 12 && data[9] == tpAckType {
			conn.transport.resolvePending(data[10], data[11])
		}
		return true
	}

	conn.transport.mu.Lock()
	defer conn.transport.mu.Unlock()

	if sof {
		if len(data) < 9 {
			_ = sendTransportACK(tpChar, msgID, tpAckSeq)
			return true
		}
		total := binary.LittleEndian.Uint32(data[3:7])
		crc := binary.LittleEndian.Uint16(data[7:9])
		chunk := data[9:]
		if total > tpMaxReceiveSDU {
			_ = sendTransportACK(tpChar, msgID, tpAckTooLong)
			return true
		}
		if uint32(len(chunk)) > total {
			_ = sendTransportACK(tpChar, msgID, tpAckSeq)
			return true
		}

		if sof && eof {
			if uint32(len(chunk)) != total {
				_ = sendTransportACK(tpChar, msgID, tpAckSeq)
				return true
			}
			if crc16CCITT(chunk) != crc {
				_ = sendTransportACK(tpChar, msgID, tpAckCRC)
				return true
			}
			_ = sendTransportACK(tpChar, msgID, tpAckOK)
			m.broadcastTransportPayload(conn, channel, chunk)
			return true
		}

		buf := make([]byte, total)
		copy(buf, chunk)
		conn.transport.rx = &bleTransportRx{
			buf:     buf,
			total:   total,
			got:     uint32(len(chunk)),
			crc:     crc,
			msgID:   msgID,
			channel: channel,
			nextSeq: 1,
		}
		return true
	}

	rx := conn.transport.rx
	if rx == nil || rx.msgID != msgID || rx.channel != channel || rx.nextSeq != seq {
		conn.transport.rx = nil
		_ = sendTransportACK(tpChar, msgID, tpAckSeq)
		return true
	}

	chunk := data[3:]
	if rx.got+uint32(len(chunk)) > rx.total {
		conn.transport.rx = nil
		_ = sendTransportACK(tpChar, msgID, tpAckSeq)
		return true
	}

	copy(rx.buf[rx.got:], chunk)
	rx.got += uint32(len(chunk))
	rx.nextSeq += 1
	if !eof {
		return true
	}

	conn.transport.rx = nil
	if rx.got != rx.total {
		_ = sendTransportACK(tpChar, msgID, tpAckSeq)
		return true
	}
	if crc16CCITT(rx.buf) != rx.crc {
		_ = sendTransportACK(tpChar, msgID, tpAckCRC)
		return true
	}

	_ = sendTransportACK(tpChar, msgID, tpAckOK)
	m.broadcastTransportPayload(conn, channel, rx.buf)
	return true
}

func (m *bleManager) broadcastTransportPayload(conn *bleConnection, channel byte, payload []byte) {
	charUUID, ok := transportChannelToChar[channel]
	if !ok {
		charUUID = uuidCharTP
	}
	transportChannel := int(channel)
	copyBuf := append([]byte(nil), payload...)
	m.broadcast(bleEvent{
		Type:               "notification",
		Timestamp:          time.Now().Format(time.RFC3339Nano),
		Address:            conn.address,
		Name:               conn.name,
		ServiceUUID:        uuidSvcSatellai,
		CharacteristicUUID: charUUID,
		TransportChannel:   &transportChannel,
		Data:               base64.StdEncoding.EncodeToString(copyBuf),
	})
}

func (t *bleTransportState) nextMsgID() byte {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.txMsgID += 1
	return t.txMsgID
}

func (t *bleTransportState) registerPending(msgID byte) chan byte {
	t.mu.Lock()
	defer t.mu.Unlock()
	ch := make(chan byte, 1)
	t.pending[msgID] = ch
	return ch
}

func (t *bleTransportState) clearPending(msgID byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.pending, msgID)
}

func (t *bleTransportState) resolvePending(msgID, status byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	ch, ok := t.pending[msgID]
	if !ok {
		return
	}
	select {
	case ch <- status:
	default:
	}
}

func characteristicPayloadLimit(char bluetooth.DeviceCharacteristic) int {
	mtu, err := char.GetMTU()
	if err != nil || mtu <= 3 {
		return 20
	}
	return int(mtu) - 3
}

func writeBLECharacteristic(char bluetooth.DeviceCharacteristic, key string, payload []byte) error {
	if _, err := char.WriteWithoutResponse(payload); err == nil {
		return nil
	}
	if _, err := char.Write(payload); err == nil {
		return nil
	} else {
		return fmt.Errorf("写入特征失败 %s: %w", key, err)
	}
}

func buildTransportFrames(channel, msgID byte, payload []byte, frameLimit int) [][]byte {
	crc := crc16CCITT(payload)
	firstPayloadMax := frameLimit - 3 - 6
	restPayloadMax := frameLimit - 3
	if firstPayloadMax < 0 {
		firstPayloadMax = 0
	}
	if restPayloadMax < 1 {
		restPayloadMax = 1
	}

	frames := make([][]byte, 0)
	offset := 0
	seq := byte(0)
	for offset < len(payload) || (len(payload) == 0 && seq == 0) {
		isFirst := seq == 0
		capacity := restPayloadMax
		if isFirst {
			capacity = firstPayloadMax
		}
		chunkLen := len(payload) - offset
		if chunkLen > capacity {
			chunkLen = capacity
		}
		isLast := offset+chunkLen >= len(payload)

		headerLen := 3
		if isFirst {
			headerLen += 6
		}
		frame := make([]byte, headerLen+chunkLen)
		ctrl := channel & 0x0f
		if isFirst {
			ctrl |= tpCtrlSOF
		}
		if isLast {
			ctrl |= tpCtrlEOF
		}
		frame[0] = ctrl
		frame[1] = msgID
		frame[2] = seq
		payloadOffset := 3
		if isFirst {
			binary.LittleEndian.PutUint32(frame[3:7], uint32(len(payload)))
			binary.LittleEndian.PutUint16(frame[7:9], crc)
			payloadOffset = 9
		}
		copy(frame[payloadOffset:], payload[offset:offset+chunkLen])
		frames = append(frames, frame)

		offset += chunkLen
		seq += 1
	}
	return frames
}

func sendTransportACK(char bluetooth.DeviceCharacteristic, msgID, status byte) error {
	payload := []byte{tpAckType, msgID, status}
	crc := crc16CCITT(payload)
	frame := []byte{
		tpCtrlSOF | tpCtrlEOF | tpChCtrl,
		0x00,
		0x00,
		0x03, 0x00, 0x00, 0x00,
		byte(crc),
		byte(crc >> 8),
		payload[0], payload[1], payload[2],
	}
	if _, err := char.WriteWithoutResponse(frame); err == nil {
		return nil
	}
	_, err := char.Write(frame)
	return err
}

func crc16CCITT(data []byte) uint16 {
	crc := uint16(0xffff)
	for _, value := range data {
		e := byte(crc) ^ value
		f := e ^ (e << 4)
		crc = (crc >> 8) ^ (uint16(f) << 8) ^ (uint16(f) << 3) ^ (uint16(f) >> 4)
	}
	return crc
}
