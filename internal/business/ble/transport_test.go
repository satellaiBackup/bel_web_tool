package ble

import (
	"encoding/binary"
	"testing"
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
