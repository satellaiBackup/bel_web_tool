package ble

import (
	"errors"
	"strings"
	"testing"
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
