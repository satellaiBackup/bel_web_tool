package ble

import (
	"encoding/base64"
	"encoding/binary"
	"errors"
	"testing"
	"time"

	"tinygo.org/x/bluetooth"
)

func TestCRC16CCITT(t *testing.T) {
	if got := crc16CCITT([]byte("123456789")); got != 0x6f91 {
		t.Fatalf("crc16CCITT() = 0x%04x, want 0x6f91", got)
	}
}

func TestBuildTransportFramesSingleFrame(t *testing.T) {
	payload := []byte("hello")
	frames := buildTransportFrames(3, 7, payload, 20)
	if len(frames) != 1 {
		t.Fatalf("len(frames) = %d, want 1", len(frames))
	}

	frame := frames[0]
	if frame[0] != tpCtrlSOF|tpCtrlEOF|3 {
		t.Fatalf("ctrl = 0x%02x, want 0x%02x", frame[0], tpCtrlSOF|tpCtrlEOF|3)
	}
	if frame[1] != 7 || frame[2] != 0 {
		t.Fatalf("msg/seq = %d/%d, want 7/0", frame[1], frame[2])
	}
	if total := binary.LittleEndian.Uint32(frame[3:7]); total != uint32(len(payload)) {
		t.Fatalf("total = %d, want %d", total, len(payload))
	}
	if crc := binary.LittleEndian.Uint16(frame[7:9]); crc != crc16CCITT(payload) {
		t.Fatalf("crc = 0x%04x, want 0x%04x", crc, crc16CCITT(payload))
	}
	if string(frame[9:]) != string(payload) {
		t.Fatalf("payload = %q, want %q", frame[9:], payload)
	}
}

func TestBuildTransportFramesMultipleFrames(t *testing.T) {
	payload := []byte("abcdefghijklmnopqrstuvwxyz")
	frames := buildTransportFrames(4, 9, payload, 16)
	if len(frames) != 3 {
		t.Fatalf("len(frames) = %d, want 3", len(frames))
	}

	if frames[0][0] != tpCtrlSOF|4 {
		t.Fatalf("first ctrl = 0x%02x, want 0x%02x", frames[0][0], tpCtrlSOF|4)
	}
	if frames[1][0] != 4 {
		t.Fatalf("middle ctrl = 0x%02x, want 0x04", frames[1][0])
	}
	if frames[2][0] != tpCtrlEOF|4 {
		t.Fatalf("last ctrl = 0x%02x, want 0x%02x", frames[2][0], tpCtrlEOF|4)
	}

	var reassembled []byte
	for index, frame := range frames {
		if frame[1] != 9 || frame[2] != byte(index) {
			t.Fatalf("frame %d msg/seq = %d/%d, want 9/%d", index, frame[1], frame[2], index)
		}
		if index == 0 {
			reassembled = append(reassembled, frame[9:]...)
		} else {
			reassembled = append(reassembled, frame[3:]...)
		}
	}
	if string(reassembled) != string(payload) {
		t.Fatalf("reassembled = %q, want %q", reassembled, payload)
	}
}

func TestTransportReceiveLimitAcceptsEsimHttpsRequest(t *testing.T) {
	const esimHTTPSRequestBytes = 2479

	if tpMaxReceiveSDU < esimHTTPSRequestBytes {
		t.Fatalf("tpMaxReceiveSDU = %d, want at least %d", tpMaxReceiveSDU, esimHTTPSRequestBytes)
	}
	if tpMaxSendSDU >= tpMaxReceiveSDU {
		t.Fatalf("tpMaxSendSDU = %d should stay below receive limit %d", tpMaxSendSDU, tpMaxReceiveSDU)
	}
}

func TestBuildTransportFramesZeroAndMTUBoundary(t *testing.T) {
	tests := []struct {
		name       string
		payloadLen int
		frameLimit int
		wantFrames int
	}{
		{name: "zero bytes", payloadLen: 0, frameLimit: 20, wantFrames: 1},
		{name: "first frame boundary", payloadLen: 3, frameLimit: 12, wantFrames: 1},
		{name: "one byte over first frame", payloadLen: 4, frameLimit: 12, wantFrames: 2},
		{name: "2048 byte device limit", payloadLen: tpMaxSendSDU, frameLimit: 244, wantFrames: 9},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload := make([]byte, test.payloadLen)
			frames := buildTransportFrames(6, 1, payload, test.frameLimit)
			if len(frames) != test.wantFrames {
				t.Fatalf("frame count = %d, want %d", len(frames), test.wantFrames)
			}
			for index, frame := range frames {
				if len(frame) > test.frameLimit {
					t.Fatalf("frame %d length = %d, limit %d", index, len(frame), test.frameLimit)
				}
			}
		})
	}
}

func TestSendTransportWithRetryHandlesACKNAKAndTimeout(t *testing.T) {
	tests := []struct {
		name        string
		waitResults []struct {
			status byte
			err    error
		}
		wantAttempts int
		wantErr      error
	}{
		{
			name: "ACK succeeds immediately",
			waitResults: []struct {
				status byte
				err    error
			}{{status: tpAckOK}},
			wantAttempts: 1,
		},
		{
			name: "NAK retries whole message",
			waitResults: []struct {
				status byte
				err    error
			}{{status: tpAckCRC}, {status: tpAckOK}},
			wantAttempts: 2,
		},
		{
			name: "timeout stops after retry limit",
			waitResults: []struct {
				status byte
				err    error
			}{{err: errTransportNoACK}, {err: errTransportNoACK}, {err: errTransportNoACK}},
			wantAttempts: 3,
			wantErr:      errTransportNoACK,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			state := newBLETransportState()
			waitIndex := 0
			attempts := 0
			lastMsgID := byte(0)
			writeFrame := func(frame []byte) error {
				if frame[1] != lastMsgID {
					lastMsgID = frame[1]
					attempts++
				}
				return nil
			}
			waitACK := func(_ <-chan byte, _ time.Duration) (byte, error) {
				result := test.waitResults[waitIndex]
				waitIndex++
				return result.status, result.err
			}

			err := sendTransportWithRetry(state, 6, []byte("payload"), 20, 2, time.Second, writeFrame, waitACK)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("error = %v, want %v", err, test.wantErr)
			}
			if attempts != test.wantAttempts {
				t.Fatalf("attempts = %d, want %d", attempts, test.wantAttempts)
			}
			if len(state.pending) != 0 {
				t.Fatalf("pending ACK entries leaked: %d", len(state.pending))
			}
		})
	}
}

func TestSendTransportWithRetryRejectsOversizeBeforeWrite(t *testing.T) {
	writeCount := 0
	err := sendTransportWithRetry(
		newBLETransportState(),
		6,
		make([]byte, tpMaxSendSDU+1),
		244,
		2,
		time.Second,
		func([]byte) error {
			writeCount++
			return nil
		},
		nil,
	)
	if err == nil {
		t.Fatal("oversize payload must be rejected")
	}
	if writeCount != 0 {
		t.Fatalf("write count = %d, want 0", writeCount)
	}
}

type transportACKRecord struct {
	msgID  byte
	status byte
}

func newTransportReceiveFixture() (*bleManager, *bleConnection, chan bleEvent, *[]transportACKRecord) {
	records := make([]transportACKRecord, 0)
	events := make(chan bleEvent, 64)
	manager := &bleManager{
		subscribers: map[chan bleEvent]struct{}{events: {}},
		transportACKOperation: func(_ bluetooth.DeviceCharacteristic, msgID, status byte) error {
			records = append(records, transportACKRecord{msgID: msgID, status: status})
			return nil
		},
	}
	connection := &bleConnection{
		address:   "AA:BB:CC:DD:EE:FF",
		name:      "fixture",
		transport: newBLETransportState(),
	}
	return manager, connection, events, &records
}

func findTransportNotification(events chan bleEvent) *bleEvent {
	for len(events) > 0 {
		event := <-events
		if event.Type == "notification" {
			copyEvent := event
			return &copyEvent
		}
	}
	return nil
}

func TestTransportReceiveReassemblesAndAcknowledges(t *testing.T) {
	manager, connection, events, records := newTransportReceiveFixture()
	payload := []byte("abcdefghijklmnopqrstuvwxyz")
	frames := buildTransportFrames(3, 19, payload, 16)
	for _, frame := range frames {
		manager.handleTransportNotification(connection, bluetooth.DeviceCharacteristic{}, frame)
	}

	if len(*records) != 1 || (*records)[0] != (transportACKRecord{msgID: 19, status: tpAckOK}) {
		t.Fatalf("ACK records = %#v", *records)
	}
	event := findTransportNotification(events)
	if event == nil {
		t.Fatal("reassembled notification was not broadcast")
	}
	decoded, err := base64.StdEncoding.DecodeString(event.Data)
	if err != nil || string(decoded) != string(payload) {
		t.Fatalf("notification payload = %q, err=%v", decoded, err)
	}
}

func TestTransportReceiveRejectsCRCAndOutOfOrderFrames(t *testing.T) {
	t.Run("CRC", func(t *testing.T) {
		manager, connection, events, records := newTransportReceiveFixture()
		frame := buildTransportFrames(3, 20, []byte("payload"), 20)[0]
		frame[len(frame)-1] ^= 0xff
		manager.handleTransportNotification(connection, bluetooth.DeviceCharacteristic{}, frame)
		if len(*records) != 1 || (*records)[0].status != tpAckCRC {
			t.Fatalf("ACK records = %#v", *records)
		}
		if event := findTransportNotification(events); event != nil {
			t.Fatalf("unexpected notification: %#v", event)
		}
	})

	t.Run("out of order", func(t *testing.T) {
		manager, connection, events, records := newTransportReceiveFixture()
		frames := buildTransportFrames(3, 21, []byte("abcdefghijklmnopqrstuvwxyz"), 16)
		manager.handleTransportNotification(connection, bluetooth.DeviceCharacteristic{}, frames[0])
		manager.handleTransportNotification(connection, bluetooth.DeviceCharacteristic{}, frames[2])
		if len(*records) != 1 || (*records)[0].status != tpAckSeq {
			t.Fatalf("ACK records = %#v", *records)
		}
		if event := findTransportNotification(events); event != nil {
			t.Fatalf("unexpected notification: %#v", event)
		}
	})
}

func TestTransportReceiveTimeoutReleasesStateAndReturnsNAK(t *testing.T) {
	ack := make(chan transportACKRecord, 1)
	manager := &bleManager{
		subscribers: make(map[chan bleEvent]struct{}),
		transportACKOperation: func(_ bluetooth.DeviceCharacteristic, msgID, status byte) error {
			ack <- transportACKRecord{msgID: msgID, status: status}
			return nil
		},
	}
	state := newBLETransportState()
	state.rxTimeout = 10 * time.Millisecond
	connection := &bleConnection{address: "AA", transport: state}
	frames := buildTransportFrames(3, 22, []byte("abcdefghijklmnopqrstuvwxyz"), 16)
	manager.handleTransportNotification(connection, bluetooth.DeviceCharacteristic{}, frames[0])

	select {
	case record := <-ack:
		if record != (transportACKRecord{msgID: 22, status: tpAckTimeout}) {
			t.Fatalf("ACK record = %#v", record)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for receive timeout NAK")
	}

	state.mu.Lock()
	rx := state.rx
	timer := state.rxTimer
	state.mu.Unlock()
	if rx != nil || timer != nil {
		t.Fatalf("receive state leaked: rx=%#v timer=%#v", rx, timer)
	}
}

func TestTransportControlACKResolvesPendingSend(t *testing.T) {
	manager, connection, _, _ := newTransportReceiveFixture()
	pending := connection.transport.registerPending(23)
	ackFrame := buildTransportFrames(tpChCtrl, 0, []byte{tpAckType, 23, tpAckOK}, 20)[0]
	manager.handleTransportNotification(connection, bluetooth.DeviceCharacteristic{}, ackFrame)

	select {
	case status := <-pending:
		if status != tpAckOK {
			t.Fatalf("status = %d, want %d", status, tpAckOK)
		}
	default:
		t.Fatal("pending sender was not notified")
	}
}

func TestTransportCloseClearsReceiveTimerAndPendingACKs(t *testing.T) {
	state := newBLETransportState()
	state.mu.Lock()
	state.rx = &bleTransportRx{msgID: 1}
	state.armReceiveTimeoutLocked(state.rx)
	state.mu.Unlock()
	pending := state.registerPending(2)
	state.close()

	state.mu.Lock()
	rx := state.rx
	timer := state.rxTimer
	pendingCount := len(state.pending)
	state.mu.Unlock()
	if rx != nil || timer != nil || pendingCount != 0 {
		t.Fatalf("transport state leaked: rx=%#v timer=%#v pending=%d", rx, timer, pendingCount)
	}
	select {
	case status := <-pending:
		if status != tpAckTimeout {
			t.Fatalf("pending status = %d, want %d", status, tpAckTimeout)
		}
	default:
		t.Fatal("pending sender was not released")
	}
}
