package ble

import (
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
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
	tpMaxSendSDU    = 2048
	tpMaxReceiveSDU = 8192
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
	if len(payload) > tpMaxSendSDU {
		return fmt.Errorf("大包数据长度 %d 超过设备上限 %d 字节", len(payload), tpMaxSendSDU)
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
		log.Printf("[ble-tp] tx start ch=%d msg=%d len=%d frames=%d attempt=%d frameLimit=%d", channel, msgID, len(payload), len(frames), attempt+1, frameLimit)

		lastErr = nil
		for _, frame := range frames {
			if err := writeBLECharacteristic(tpChar, tpKey, frame); err != nil {
				lastErr = err
				break
			}
		}
		if lastErr != nil {
			log.Printf("[ble-tp] tx write failed ch=%d msg=%d err=%v", channel, msgID, lastErr)
			conn.transport.clearPending(msgID)
			continue
		}

		select {
		case status := <-ackCh:
			conn.transport.clearPending(msgID)
			if status == tpAckOK {
				log.Printf("[ble-tp] tx ack ok ch=%d msg=%d", channel, msgID)
				return nil
			}
			log.Printf("[ble-tp] tx nak ch=%d msg=%d status=%d", channel, msgID, status)
			lastErr = fmt.Errorf("设备返回大包 NAK: status=%d", status)
		case <-time.After(tpAckWait):
			conn.transport.clearPending(msgID)
			log.Printf("[ble-tp] tx ack timeout ch=%d msg=%d", channel, msgID)
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
	log.Printf("[ble-tp] rx frame ch=%d msg=%d seq=%d sof=%t eof=%t len=%d", channel, msgID, seq, sof, eof, len(data))
	m.broadcastTransportDebug(conn, "frame", channel, msgID, seq, sof, eof, len(data), len(data)-3, 0, 0, "")

	if channel == tpChCtrl {
		if len(data) >= 12 && data[9] == tpAckType {
			log.Printf("[ble-tp] rx ack msg=%d status=%d", data[10], data[11])
			m.broadcastTransportDebug(conn, "ack", channel, msgID, seq, sof, eof, len(data), len(data)-9, 0, 0, fmt.Sprintf("ack_msg=%d status=%d", data[10], data[11]))
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
		m.broadcastTransportDebug(conn, "chunk", channel, msgID, seq, sof, eof, len(data), len(chunk), uint32(len(chunk)), total, "sof")
		if total > tpMaxReceiveSDU {
			log.Printf("[ble-tp] rx reject too long ch=%d msg=%d total=%d max=%d", channel, msgID, total, tpMaxReceiveSDU)
			m.broadcastTransportDebug(conn, "reject", channel, msgID, seq, sof, eof, len(data), len(chunk), uint32(len(chunk)), total, "too_long")
			_ = sendTransportACK(tpChar, msgID, tpAckTooLong)
			return true
		}
		if uint32(len(chunk)) > total {
			log.Printf("[ble-tp] rx reject first chunk too long ch=%d msg=%d chunk=%d total=%d", channel, msgID, len(chunk), total)
			m.broadcastTransportDebug(conn, "reject", channel, msgID, seq, sof, eof, len(data), len(chunk), uint32(len(chunk)), total, "first_chunk_too_long")
			_ = sendTransportACK(tpChar, msgID, tpAckSeq)
			return true
		}

		if sof && eof {
			if uint32(len(chunk)) != total {
				log.Printf("[ble-tp] rx single len mismatch ch=%d msg=%d chunk=%d total=%d", channel, msgID, len(chunk), total)
				m.broadcastTransportDebug(conn, "reject", channel, msgID, seq, sof, eof, len(data), len(chunk), uint32(len(chunk)), total, "single_len_mismatch")
				_ = sendTransportACK(tpChar, msgID, tpAckSeq)
				return true
			}
			if crc16CCITT(chunk) != crc {
				log.Printf("[ble-tp] rx single crc fail ch=%d msg=%d len=%d", channel, msgID, len(chunk))
				m.broadcastTransportDebug(conn, "reject", channel, msgID, seq, sof, eof, len(data), len(chunk), uint32(len(chunk)), total, "single_crc")
				_ = sendTransportACK(tpChar, msgID, tpAckCRC)
				return true
			}
			_ = sendTransportACK(tpChar, msgID, tpAckOK)
			log.Printf("[ble-tp] rx complete ch=%d msg=%d len=%d single=true", channel, msgID, len(chunk))
			m.broadcastTransportDebug(conn, "complete", channel, msgID, seq, sof, eof, len(data), len(chunk), total, total, "single")
			m.broadcastTransportPayload(conn, channel, chunk)
			return true
		}

		log.Printf("[ble-tp] rx start ch=%d msg=%d total=%d first=%d crc=0x%04x", channel, msgID, total, len(chunk), crc)
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
		if rx == nil {
			log.Printf("[ble-tp] rx seq reject no active rx ch=%d msg=%d seq=%d", channel, msgID, seq)
		} else {
			log.Printf("[ble-tp] rx seq reject got ch=%d msg=%d seq=%d want ch=%d msg=%d seq=%d", channel, msgID, seq, rx.channel, rx.msgID, rx.nextSeq)
		}
		conn.transport.rx = nil
		_ = sendTransportACK(tpChar, msgID, tpAckSeq)
		return true
	}

	chunk := data[3:]
	if rx.got+uint32(len(chunk)) > rx.total {
		log.Printf("[ble-tp] rx overflow ch=%d msg=%d got=%d chunk=%d total=%d", channel, msgID, rx.got, len(chunk), rx.total)
		m.broadcastTransportDebug(conn, "reject", channel, msgID, seq, sof, eof, len(data), len(chunk), rx.got, rx.total, "overflow")
		conn.transport.rx = nil
		_ = sendTransportACK(tpChar, msgID, tpAckSeq)
		return true
	}

	copy(rx.buf[rx.got:], chunk)
	rx.got += uint32(len(chunk))
	rx.nextSeq += 1
	log.Printf("[ble-tp] rx chunk ch=%d msg=%d seq=%d got=%d/%d eof=%t", channel, msgID, seq, rx.got, rx.total, eof)
	m.broadcastTransportDebug(conn, "chunk", channel, msgID, seq, sof, eof, len(data), len(chunk), rx.got, rx.total, "")
	if !eof {
		return true
	}

	conn.transport.rx = nil
	if rx.got != rx.total {
		log.Printf("[ble-tp] rx final len mismatch ch=%d msg=%d got=%d total=%d", channel, msgID, rx.got, rx.total)
		m.broadcastTransportDebug(conn, "reject", channel, msgID, seq, sof, eof, len(data), len(chunk), rx.got, rx.total, "final_len_mismatch")
		_ = sendTransportACK(tpChar, msgID, tpAckSeq)
		return true
	}
	if crc16CCITT(rx.buf) != rx.crc {
		log.Printf("[ble-tp] rx final crc fail ch=%d msg=%d len=%d", channel, msgID, len(rx.buf))
		m.broadcastTransportDebug(conn, "reject", channel, msgID, seq, sof, eof, len(data), len(chunk), rx.got, rx.total, "final_crc")
		_ = sendTransportACK(tpChar, msgID, tpAckCRC)
		return true
	}

	_ = sendTransportACK(tpChar, msgID, tpAckOK)
	log.Printf("[ble-tp] rx complete ch=%d msg=%d len=%d single=false", channel, msgID, len(rx.buf))
	m.broadcastTransportDebug(conn, "complete", channel, msgID, seq, sof, eof, len(data), len(chunk), rx.got, rx.total, "multi")
	m.broadcastTransportPayload(conn, channel, rx.buf)
	return true
}

func (m *bleManager) broadcastTransportDebug(conn *bleConnection, phase string, channel, msgID, seq byte, sof, eof bool, frameLen, chunkLen int, got, total uint32, status string) {
	transportChannel := int(channel)
	m.broadcast(bleEvent{
		Type:             "transport_debug",
		Timestamp:        time.Now().Format(time.RFC3339Nano),
		Address:          conn.address,
		Name:             conn.name,
		TransportChannel: &transportChannel,
		TransportDebug: &bleTransportDebug{
			Phase:    phase,
			Channel:  int(channel),
			MsgID:    int(msgID),
			Seq:      int(seq),
			SOF:      sof,
			EOF:      eof,
			FrameLen: frameLen,
			ChunkLen: chunkLen,
			Got:      got,
			Total:    total,
			Status:   status,
		},
	})
}

func (m *bleManager) broadcastTransportPayload(conn *bleConnection, channel byte, payload []byte) {
	charUUID, ok := transportChannelToChar[channel]
	if !ok {
		charUUID = uuidCharTP
	}
	log.Printf("[ble-tp] broadcast ch=%d char=%s len=%d", channel, charUUID, len(payload))
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
