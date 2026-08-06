package ble

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestClearConnectionIfCurrent(t *testing.T) {
	current := &bleConnection{address: "AA:BB:CC:DD:EE:FF"}
	stale := &bleConnection{address: "11:22:33:44:55:66"}
	manager := &bleManager{connection: current}

	if manager.clearConnectionIfCurrent(stale) {
		t.Fatal("stale connection must not clear the active connection")
	}
	if manager.connection != current {
		t.Fatal("active connection changed after clearing a stale connection")
	}
	if !manager.clearConnectionIfCurrent(current) {
		t.Fatal("active connection should be cleared")
	}
	if manager.connection != nil {
		t.Fatal("active connection was not cleared")
	}
}

func TestBLEGATTSessionError(t *testing.T) {
	err := newBLEGATTSessionError("发现服务失败", errors.New("operation failed with code 1"))

	if !errors.Is(err, errBLEGATTSessionUnavailable) {
		t.Fatal("GATT session error must wrap errBLEGATTSessionUnavailable")
	}
	if !strings.Contains(err.Error(), "发现服务失败: operation failed with code 1") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestBLEAttributeNotFoundError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "service missing", err: errors.New("bluetooth: did not find all requested services"), want: true},
		{name: "characteristic missing", err: errors.New("bluetooth: did not find all requested characteristic"), want: true},
		{name: "GATT unavailable", err: errors.New("could not retrieve device services, operation failed with code 1"), want: false},
		{name: "nil", err: nil, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isBLEAttributeNotFoundError(tt.err); got != tt.want {
				t.Fatalf("isBLEAttributeNotFoundError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestInvalidateConnectionCleansTransportAndBroadcastsReason(t *testing.T) {
	transport := newBLETransportState()
	transport.mu.Lock()
	transport.rx = &bleTransportRx{msgID: 1}
	transport.armReceiveTimeoutLocked(transport.rx)
	transport.mu.Unlock()
	pending := transport.registerPending(2)
	disconnectCount := 0
	connection := &bleConnection{
		address:   "AA:BB:CC:DD:EE:FF",
		name:      "fixture",
		transport: transport,
		disconnect: func() error {
			disconnectCount++
			return nil
		},
	}
	events := make(chan bleEvent, 1)
	manager := &bleManager{
		connection:  connection,
		subscribers: map[chan bleEvent]struct{}{events: {}},
	}
	cause := newBLEGATTSessionError("write failed", errors.New("fixture"))

	manager.invalidateConnection(connection, cause)

	if manager.connection != nil {
		t.Fatal("invalid GATT connection was not cleared")
	}
	if disconnectCount != 1 {
		t.Fatalf("disconnect count = %d, want 1", disconnectCount)
	}
	select {
	case status := <-pending:
		if status != tpAckTimeout {
			t.Fatalf("pending status = %d, want %d", status, tpAckTimeout)
		}
	default:
		t.Fatal("pending transport write was not released")
	}
	select {
	case event := <-events:
		if event.Type != "disconnected" || event.Address != connection.address || !strings.Contains(event.Error, "fixture") {
			t.Fatalf("unexpected disconnect event: %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("disconnect event was not broadcast")
	}

	transport.mu.Lock()
	rx := transport.rx
	timer := transport.rxTimer
	transport.mu.Unlock()
	if rx != nil || timer != nil {
		t.Fatalf("transport receive resources leaked: rx=%#v timer=%#v", rx, timer)
	}
}

func TestBLEScanStateDeduplicatesFiltersAndSorts(t *testing.T) {
	state := &bleScanState{results: make(map[string]bleScanDevice)}
	state.addResult(bleScanDevice{Address: "BB", Name: "SAT-B", RSSI: -70, SeenCount: 1})
	state.addResult(bleScanDevice{Address: "AA", Name: "SAT-A", RSSI: -50, SeenCount: 1})
	state.addResult(bleScanDevice{Address: "BB", Name: "SAT-B", RSSI: -40, SeenCount: 1})
	state.addResult(bleScanDevice{Address: "CC", Name: "OTHER", RSSI: -10, SeenCount: 1})

	devices := state.snapshot(" sat-")
	if len(devices) != 2 {
		t.Fatalf("device count = %d, want 2", len(devices))
	}
	if devices[0].Address != "BB" || devices[0].RSSI != -40 || devices[0].SeenCount != 2 {
		t.Fatalf("first device = %#v", devices[0])
	}
	if devices[1].Address != "AA" {
		t.Fatalf("second device = %#v", devices[1])
	}
}
