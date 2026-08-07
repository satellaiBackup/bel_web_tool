package ble

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func newHTTPTestManager() *bleManager {
	return &bleManager{
		lastScanResults: make(map[string]bleScanDevice),
		subscribers:     make(map[chan bleEvent]struct{}),
	}
}

func performBLERequest(manager *bleManager, method, path, body string) *httptest.ResponseRecorder {
	mux := http.NewServeMux()
	manager.registerRoutes(mux)
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)
	return recorder
}

func decodeErrorResponse(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	return payload.Error
}

func TestBLERoutesRejectUnsupportedMethods(t *testing.T) {
	tests := []struct {
		path   string
		method string
	}{
		{path: "/api/ble/scan", method: http.MethodPost},
		{path: "/api/ble/connect", method: http.MethodGet},
		{path: "/api/ble/disconnect", method: http.MethodGet},
		{path: "/api/ble/state", method: http.MethodPost},
		{path: "/api/ble/write", method: http.MethodGet},
		{path: "/api/ble/subscribe", method: http.MethodGet},
		{path: "/api/ble/events", method: http.MethodPost},
	}

	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			recorder := performBLERequest(newHTTPTestManager(), test.method, test.path, "")
			if recorder.Code != http.StatusMethodNotAllowed {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusMethodNotAllowed)
			}
		})
	}
}

func TestBLEScanRouteValidatesAndCapsTimeout(t *testing.T) {
	manager := newHTTPTestManager()
	var gotPrefix string
	var gotTimeout time.Duration
	manager.scanOperation = func(_ context.Context, prefix string, timeout time.Duration) ([]bleScanDevice, error) {
		gotPrefix = prefix
		gotTimeout = timeout
		return []bleScanDevice{{Address: "AA:BB:CC:DD:EE:FF", Name: "SATELLAI", RSSI: -42}}, nil
	}

	for _, timeout := range []string{"abc", "0", "-1"} {
		recorder := performBLERequest(manager, http.MethodGet, "/api/ble/scan?timeout_ms="+timeout, "")
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("timeout %q status = %d, want %d", timeout, recorder.Code, http.StatusBadRequest)
		}
	}

	recorder := performBLERequest(manager, http.MethodGet, "/api/ble/scan?prefix=%20SAT%20&timeout_ms=60000", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if gotPrefix != "SAT" {
		t.Fatalf("prefix = %q, want SAT", gotPrefix)
	}
	if gotTimeout != maxBLEScanTimeout {
		t.Fatalf("timeout = %s, want %s", gotTimeout, maxBLEScanTimeout)
	}
}

func TestBLEConnectRouteUsesInjectedOperation(t *testing.T) {
	manager := newHTTPTestManager()
	var gotAddress string
	manager.connectOperation = func(address string) (bleDeviceInfo, error) {
		gotAddress = address
		return bleDeviceInfo{Address: strings.ToUpper(address), Name: "fixture"}, nil
	}

	recorder := performBLERequest(manager, http.MethodPost, "/api/ble/connect", `{"address":" aa:bb:cc:dd:ee:ff "}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if gotAddress != "aa:bb:cc:dd:ee:ff" {
		t.Fatalf("address = %q", gotAddress)
	}

	recorder = performBLERequest(manager, http.MethodPost, "/api/ble/connect", "{")
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid JSON status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	recorder = performBLERequest(manager, http.MethodPost, "/api/ble/connect", `{"address":" "}`)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("empty address status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestBLEWriteAndSubscribeRoutesPreserveProtocolFields(t *testing.T) {
	manager := newHTTPTestManager()
	var gotService, gotCharacteristic string
	var gotPayload []byte
	var gotChannel *int
	manager.writeOperation = func(service, characteristic string, payload []byte, channel *int) error {
		gotService = service
		gotCharacteristic = characteristic
		gotPayload = append([]byte(nil), payload...)
		gotChannel = channel
		return nil
	}

	encoded := base64.StdEncoding.EncodeToString([]byte{0x00, 0x7f, 0xff})
	body := `{"serviceUuid":"svc","characteristicUuid":"char","data":"` + encoded + `","transportChannel":6}`
	recorder := performBLERequest(manager, http.MethodPost, "/api/ble/write", body)
	if recorder.Code != http.StatusOK {
		t.Fatalf("write status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if gotService != "svc" || gotCharacteristic != "char" || !bytes.Equal(gotPayload, []byte{0x00, 0x7f, 0xff}) {
		t.Fatalf("write fields = %q %q %v", gotService, gotCharacteristic, gotPayload)
	}
	if gotChannel == nil || *gotChannel != 6 {
		t.Fatalf("transport channel = %v", gotChannel)
	}

	recorder = performBLERequest(manager, http.MethodPost, "/api/ble/write", `{"data":"%%%"}`)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid base64 status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}

	manager.subscribeOperation = func(service, characteristic string) error {
		gotService = service
		gotCharacteristic = characteristic
		return nil
	}
	recorder = performBLERequest(manager, http.MethodPost, "/api/ble/subscribe", `{"serviceUuid":"svc2","characteristicUuid":"char2"}`)
	if recorder.Code != http.StatusOK || gotService != "svc2" || gotCharacteristic != "char2" {
		t.Fatalf("subscribe result status=%d service=%q characteristic=%q", recorder.Code, gotService, gotCharacteristic)
	}
}

func TestBLEOperationErrorsRemainObservable(t *testing.T) {
	manager := newHTTPTestManager()
	manager.disconnectOperation = func() error { return errors.New("fixture disconnect failure") }
	recorder := performBLERequest(manager, http.MethodPost, "/api/ble/disconnect", "")
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	if got := decodeErrorResponse(t, recorder); got != "fixture disconnect failure" {
		t.Fatalf("error = %q", got)
	}
}

func TestBLEMissingSubscriptionReturnsBadRequestWithoutDisconnecting(t *testing.T) {
	connection := &bleConnection{
		address: "AA:BB:CC:DD:EE:FF",
		name:    "fixture",
	}
	events := make(chan bleEvent, 1)
	manager := newHTTPTestManager()
	manager.connection = connection
	manager.subscribers[events] = struct{}{}
	manager.subscribeOperation = func(service, characteristic string) error {
		return fmt.Errorf("未找到服务 %s: bluetooth: did not find all requested services", service)
	}

	recorder := performBLERequest(
		manager,
		http.MethodPost,
		"/api/ble/subscribe",
		`{"serviceUuid":"6e400001-b5a3-f393-e0a9-e50e24dcca9e","characteristicUuid":"6e400003-b5a3-f393-e0a9-e50e24dcca9e"}`,
	)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if got := decodeErrorResponse(t, recorder); !strings.Contains(got, "未找到服务") {
		t.Fatalf("error = %q, want missing-service diagnostic", got)
	}
	if manager.connection != connection || !manager.state().Connected {
		t.Fatal("missing optional service must preserve the physical connection")
	}
	select {
	case event := <-events:
		t.Fatalf("missing optional service broadcast a false disconnect: %#v", event)
	default:
	}
}

type synchronizedFlushingRecorder struct {
	mu      sync.Mutex
	header  http.Header
	body    bytes.Buffer
	status  int
	flushed chan struct{}
}

func newSynchronizedFlushingRecorder() *synchronizedFlushingRecorder {
	return &synchronizedFlushingRecorder{
		header:  make(http.Header),
		flushed: make(chan struct{}, 8),
	}
}

func (r *synchronizedFlushingRecorder) Header() http.Header {
	return r.header
}

func (r *synchronizedFlushingRecorder) WriteHeader(status int) {
	r.mu.Lock()
	r.status = status
	r.mu.Unlock()
}

func (r *synchronizedFlushingRecorder) Write(payload []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.body.Write(payload)
}

func (r *synchronizedFlushingRecorder) Flush() {
	select {
	case r.flushed <- struct{}{}:
	default:
	}
}

func (r *synchronizedFlushingRecorder) String() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.body.String()
}

func waitForFlush(t *testing.T, recorder *synchronizedFlushingRecorder) {
	t.Helper()
	select {
	case <-recorder.flushed:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for SSE flush")
	}
}

func TestBLEEventsStreamInitialStateNotificationAndCleanup(t *testing.T) {
	manager := newHTTPTestManager()
	manager.connection = &bleConnection{
		address:   "AA:BB:CC:DD:EE:FF",
		name:      "fixture",
		transport: newBLETransportState(),
	}

	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodGet, "/api/ble/events", nil).WithContext(ctx)
	recorder := newSynchronizedFlushingRecorder()
	done := make(chan struct{})
	go func() {
		manager.handleEvents(recorder, request)
		close(done)
	}()

	waitForFlush(t, recorder)
	manager.broadcast(bleEvent{
		Type:               "notification",
		Timestamp:          "2026-08-06T00:00:00Z",
		Address:            "AA:BB:CC:DD:EE:FF",
		ServiceUUID:        "svc",
		CharacteristicUUID: "char",
		Data:               "AQI=",
	})
	waitForFlush(t, recorder)

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("SSE handler did not stop after request cancellation")
	}

	content := recorder.String()
	for _, expected := range []string{"event: connected", "AA:BB:CC:DD:EE:FF", "event: notification", "AQI="} {
		if !strings.Contains(content, expected) {
			t.Fatalf("SSE output missing %q: %s", expected, content)
		}
	}
	manager.mu.Lock()
	subscriberCount := len(manager.subscribers)
	manager.mu.Unlock()
	if subscriberCount != 0 {
		t.Fatalf("subscriber count = %d, want 0", subscriberCount)
	}
}
