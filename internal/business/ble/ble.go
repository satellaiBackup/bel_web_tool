package ble

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"tinygo.org/x/bluetooth"
)

const (
	defaultBLEScanTimeout   = 4 * time.Second
	maxBLEScanTimeout       = 15 * time.Second
	sseKeepAliveInterval    = 20 * time.Second
	bleDiscoveryAttempts    = 4
	bleDiscoveryBackoff     = 350 * time.Millisecond
	bleConnectionReadyDelay = 1200 * time.Millisecond
)

type bleManager struct {
	adapter *bluetooth.Adapter

	enableOnce sync.Once
	enableErr  error

	mu              sync.Mutex
	connection      *bleConnection
	lastScanResults map[string]bleScanDevice
	activeScan      *bleScanState
	subscribers     map[chan bleEvent]struct{}
}

type bleScanState struct {
	done chan struct{}

	mu            sync.Mutex
	results       map[string]bleScanDevice
	stopRequested bool
	err           error
}

type bleConnection struct {
	address     string
	name        string
	device      bluetooth.Device
	connectedAt time.Time

	opMu        sync.Mutex
	charCache   map[string]bluetooth.DeviceCharacteristic
	notifyState map[string]bool
}

type bleEvent struct {
	Type               string `json:"type"`
	Timestamp          string `json:"timestamp"`
	Address            string `json:"address,omitempty"`
	Name               string `json:"name,omitempty"`
	ServiceUUID        string `json:"serviceUuid,omitempty"`
	CharacteristicUUID string `json:"characteristicUuid,omitempty"`
	Data               string `json:"data,omitempty"`
	Error              string `json:"error,omitempty"`
}

type bleScanDevice struct {
	Address          string                `json:"address"`
	Name             string                `json:"name,omitempty"`
	RSSI             int16                 `json:"rssi"`
	AddressType      string                `json:"addressType"`
	SeenCount        int                   `json:"seenCount"`
	LastSeenAt       string                `json:"lastSeenAt"`
	ServiceUUIDs     []string              `json:"serviceUuids,omitempty"`
	ManufacturerData []bleManufacturerData `json:"manufacturerData,omitempty"`
	ServiceData      []bleServiceData      `json:"serviceData,omitempty"`
	RawAdvertisement string                `json:"rawAdvertisement,omitempty"`
}

type bleManufacturerData struct {
	CompanyID uint16 `json:"companyId"`
	Data      string `json:"data"`
}

type bleServiceData struct {
	UUID string `json:"uuid"`
	Data string `json:"data"`
}

type bleStateResponse struct {
	Connected bool           `json:"connected"`
	Device    *bleDeviceInfo `json:"device,omitempty"`
}

type bleDeviceInfo struct {
	Address string `json:"address"`
	Name    string `json:"name,omitempty"`
}

type bleScanResponse struct {
	Devices []bleScanDevice `json:"devices"`
}

type bleConnectRequest struct {
	Address string `json:"address"`
}

type bleWriteRequest struct {
	ServiceUUID        string `json:"serviceUuid"`
	CharacteristicUUID string `json:"characteristicUuid"`
	Data               string `json:"data"`
}

type bleSubscribeRequest struct {
	ServiceUUID        string `json:"serviceUuid"`
	CharacteristicUUID string `json:"characteristicUuid"`
}

func newBLEManager() *bleManager {
	manager := &bleManager{
		adapter:         bluetooth.DefaultAdapter,
		lastScanResults: make(map[string]bleScanDevice),
		subscribers:     make(map[chan bleEvent]struct{}),
	}
	manager.adapter.SetConnectHandler(manager.handleConnectEvent)
	return manager
}

func RegisterRoutes(mux *http.ServeMux) {
	manager := newBLEManager()
	manager.registerRoutes(mux)
}

func (m *bleManager) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/ble/scan", m.handleScan)
	mux.HandleFunc("/api/ble/connect", m.handleConnect)
	mux.HandleFunc("/api/ble/disconnect", m.handleDisconnect)
	mux.HandleFunc("/api/ble/state", m.handleState)
	mux.HandleFunc("/api/ble/write", m.handleWrite)
	mux.HandleFunc("/api/ble/subscribe", m.handleSubscribe)
	mux.HandleFunc("/api/ble/events", m.handleEvents)
}

func (m *bleManager) ensureAdapter() error {
	m.enableOnce.Do(func() {
		m.enableErr = m.adapter.Enable()
	})
	return m.enableErr
}

func (m *bleManager) handleConnectEvent(device bluetooth.Device, connected bool) {
	event := bleEvent{
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Address:   strings.ToUpper(device.Address.String()),
	}

	m.mu.Lock()
	current := m.connection
	if !connected && current != nil && strings.EqualFold(current.address, event.Address) {
		m.connection = nil
	}
	m.mu.Unlock()

	if connected {
		event.Type = "connected"
	} else {
		event.Type = "disconnected"
	}
	m.broadcast(event)
}

func (m *bleManager) handleScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 GET")
		return
	}

	timeout := defaultBLEScanTimeout
	if raw := strings.TrimSpace(r.URL.Query().Get("timeout_ms")); raw != "" {
		var requested int
		if _, err := fmt.Sscanf(raw, "%d", &requested); err == nil && requested > 0 {
			timeout = time.Duration(requested) * time.Millisecond
		}
	}
	if timeout > maxBLEScanTimeout {
		timeout = maxBLEScanTimeout
	}

	prefix := strings.TrimSpace(r.URL.Query().Get("prefix"))
	devices, err := m.scan(r.Context(), prefix, timeout)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, bleScanResponse{Devices: devices})
}

func (m *bleManager) handleConnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 POST")
		return
	}

	var req bleConnectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}

	device, err := m.connect(strings.TrimSpace(req.Address))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, bleStateResponse{Connected: true, Device: &device})
}

func (m *bleManager) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 POST")
		return
	}

	if err := m.disconnect(); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, bleStateResponse{Connected: false})
}

func (m *bleManager) handleState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 GET")
		return
	}

	state := m.state()
	writeJSON(w, http.StatusOK, state)
}

func (m *bleManager) handleWrite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 POST")
		return
	}

	var req bleWriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}

	payload, err := base64.StdEncoding.DecodeString(strings.TrimSpace(req.Data))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "data 不是有效的 base64")
		return
	}

	if err := m.writeCharacteristic(req.ServiceUUID, req.CharacteristicUUID, payload); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (m *bleManager) handleSubscribe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 POST")
		return
	}

	var req bleSubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}

	if err := m.enableNotifications(req.ServiceUUID, req.CharacteristicUUID); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (m *bleManager) handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 GET")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSONError(w, http.StatusInternalServerError, "当前环境不支持 SSE")
		return
	}

	ch := make(chan bleEvent, 32)
	m.addSubscriber(ch)
	defer m.removeSubscriber(ch)

	if state := m.state(); state.Connected && state.Device != nil {
		ch <- bleEvent{
			Type:      "connected",
			Timestamp: time.Now().Format(time.RFC3339Nano),
			Address:   state.Device.Address,
			Name:      state.Device.Name,
		}
	}

	keepAlive := time.NewTicker(sseKeepAliveInterval)
	defer keepAlive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepAlive.C:
			_, _ = w.Write([]byte(": keep-alive\n\n"))
			flusher.Flush()
		case event := <-ch:
			payload, err := json.Marshal(event)
			if err != nil {
				continue
			}
			_, _ = fmt.Fprintf(w, "event: %s\n", event.Type)
			_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
			flusher.Flush()
		}
	}
}

func (m *bleManager) addSubscriber(ch chan bleEvent) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.subscribers[ch] = struct{}{}
}

func (m *bleManager) removeSubscriber(ch chan bleEvent) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.subscribers, ch)
	close(ch)
}

func (m *bleManager) broadcast(event bleEvent) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for ch := range m.subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}

func (m *bleManager) scan(ctx context.Context, prefix string, timeout time.Duration) ([]bleScanDevice, error) {
	if err := m.ensureAdapter(); err != nil {
		return nil, fmt.Errorf("初始化蓝牙适配器失败: %w", err)
	}

	if state := m.state(); state.Connected {
		return nil, errors.New("扫描前请先断开当前设备")
	}

	activeScan, started := m.beginScanSession()
	if started {
		go m.runScanSession(activeScan)
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	select {
	case <-activeScan.done:
	case <-timeoutCtx.Done():
		m.requestScanStop(activeScan)
	}

	devices := activeScan.snapshot(prefix)
	if scanErr := activeScan.scanErr(); scanErr != nil && len(devices) == 0 {
		return nil, fmt.Errorf("蓝牙扫描失败: %w", scanErr)
	}

	m.mu.Lock()
	m.lastScanResults = make(map[string]bleScanDevice, len(devices))
	for _, device := range devices {
		m.lastScanResults[device.Address] = device
	}
	m.mu.Unlock()

	return devices, nil
}

func (m *bleManager) beginScanSession() (*bleScanState, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.activeScan != nil {
		return m.activeScan, false
	}
	state := &bleScanState{
		done:    make(chan struct{}),
		results: make(map[string]bleScanDevice),
	}
	m.activeScan = state
	return state, true
}

func (m *bleManager) runScanSession(active *bleScanState) {
	defer m.finishScanSession(active)
	err := m.adapter.Scan(func(_ *bluetooth.Adapter, result bluetooth.ScanResult) {
		active.addResult(scanResultToDevice(result))
	})
	active.setErr(err)
}

func (m *bleManager) finishScanSession(active *bleScanState) {
	m.mu.Lock()
	if m.activeScan == active {
		m.activeScan = nil
	}
	m.mu.Unlock()
	close(active.done)
}

func (m *bleManager) requestScanStop(active *bleScanState) {
	if active == nil {
		return
	}
	active.mu.Lock()
	if active.stopRequested {
		active.mu.Unlock()
		return
	}
	active.stopRequested = true
	active.mu.Unlock()
	_ = m.adapter.StopScan()
}

func (s *bleScanState) addResult(device bleScanDevice) {
	s.mu.Lock()
	defer s.mu.Unlock()

	existing, ok := s.results[device.Address]
	if !ok {
		s.results[device.Address] = device
		return
	}

	existing.SeenCount += device.SeenCount
	existing.LastSeenAt = device.LastSeenAt
	if device.Name != "" {
		existing.Name = device.Name
	}
	if device.RSSI > existing.RSSI {
		existing.RSSI = device.RSSI
	}
	if len(device.ServiceUUIDs) > 0 {
		existing.ServiceUUIDs = device.ServiceUUIDs
	}
	if len(device.ManufacturerData) > 0 {
		existing.ManufacturerData = device.ManufacturerData
	}
	if len(device.ServiceData) > 0 {
		existing.ServiceData = device.ServiceData
	}
	if device.RawAdvertisement != "" {
		existing.RawAdvertisement = device.RawAdvertisement
	}

	s.results[device.Address] = existing
}

func (s *bleScanState) setErr(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.err = err
}

func (s *bleScanState) scanErr() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.err
}

func (s *bleScanState) snapshot(prefix string) []bleScanDevice {
	normalizedPrefix := strings.ToLower(strings.TrimSpace(prefix))

	s.mu.Lock()
	defer s.mu.Unlock()

	devices := make([]bleScanDevice, 0, len(s.results))
	for _, device := range s.results {
		if normalizedPrefix != "" && !strings.HasPrefix(strings.ToLower(device.Name), normalizedPrefix) {
			continue
		}
		devices = append(devices, device)
	}

	sort.Slice(devices, func(i, j int) bool {
		if devices[i].RSSI == devices[j].RSSI {
			return devices[i].Address < devices[j].Address
		}
		return devices[i].RSSI > devices[j].RSSI
	})

	return devices
}

func scanResultToDevice(result bluetooth.ScanResult) bleScanDevice {
	device := bleScanDevice{
		Address:     strings.ToUpper(result.Address.String()),
		Name:        strings.TrimSpace(result.LocalName()),
		RSSI:        result.RSSI,
		AddressType: "public",
		SeenCount:   1,
		LastSeenAt:  time.Now().Format(time.RFC3339Nano),
	}
	if result.Address.IsRandom() {
		device.AddressType = "random"
	}

	uuids := result.ServiceUUIDs()
	if len(uuids) > 0 {
		device.ServiceUUIDs = make([]string, 0, len(uuids))
		for _, uuid := range uuids {
			device.ServiceUUIDs = append(device.ServiceUUIDs, strings.ToLower(uuid.String()))
		}
	}

	manufacturerData := result.ManufacturerData()
	if len(manufacturerData) > 0 {
		device.ManufacturerData = make([]bleManufacturerData, 0, len(manufacturerData))
		for _, entry := range manufacturerData {
			copyData := append([]byte(nil), entry.Data...)
			device.ManufacturerData = append(device.ManufacturerData, bleManufacturerData{
				CompanyID: entry.CompanyID,
				Data:      strings.ToUpper(hex.EncodeToString(copyData)),
			})
		}
	}

	serviceData := result.ServiceData()
	if len(serviceData) > 0 {
		device.ServiceData = make([]bleServiceData, 0, len(serviceData))
		for _, entry := range serviceData {
			copyData := append([]byte(nil), entry.Data...)
			device.ServiceData = append(device.ServiceData, bleServiceData{
				UUID: strings.ToLower(entry.UUID.String()),
				Data: strings.ToUpper(hex.EncodeToString(copyData)),
			})
		}
	}

	if raw := result.Bytes(); len(raw) > 0 {
		device.RawAdvertisement = strings.ToUpper(hex.EncodeToString(append([]byte(nil), raw...)))
	}

	return device
}

func (m *bleManager) connect(address string) (bleDeviceInfo, error) {
	if err := m.ensureAdapter(); err != nil {
		return bleDeviceInfo{}, fmt.Errorf("初始化蓝牙适配器失败: %w", err)
	}
	if address == "" {
		return bleDeviceInfo{}, errors.New("address 不能为空")
	}
	m.mu.Lock()
	activeScan := m.activeScan
	m.mu.Unlock()
	m.requestScanStop(activeScan)

	if err := m.disconnect(); err != nil {
		return bleDeviceInfo{}, err
	}

	mac, err := bluetooth.ParseMAC(address)
	if err != nil {
		return bleDeviceInfo{}, fmt.Errorf("MAC 地址格式无效: %w", err)
	}

	device, err := m.adapter.Connect(bluetooth.Address{MACAddress: bluetooth.MACAddress{MAC: mac}}, bluetooth.ConnectionParams{})
	if err != nil {
		return bleDeviceInfo{}, fmt.Errorf("连接设备失败: %w", err)
	}

	info := bleDeviceInfo{Address: strings.ToUpper(address)}
	m.mu.Lock()
	if scanned, ok := m.lastScanResults[info.Address]; ok {
		info.Name = scanned.Name
	}
	m.connection = &bleConnection{
		address:     info.Address,
		name:        info.Name,
		device:      device,
		connectedAt: time.Now(),
		charCache:   make(map[string]bluetooth.DeviceCharacteristic),
		notifyState: make(map[string]bool),
	}
	m.mu.Unlock()

	m.broadcast(bleEvent{
		Type:      "connected",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Address:   info.Address,
		Name:      info.Name,
	})

	return info, nil
}

func (m *bleManager) disconnect() error {
	m.mu.Lock()
	conn := m.connection
	if conn == nil {
		m.mu.Unlock()
		return nil
	}
	m.connection = nil
	m.mu.Unlock()

	_ = conn.device.Disconnect()
	m.broadcast(bleEvent{
		Type:      "disconnected",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Address:   conn.address,
		Name:      conn.name,
	})
	return nil
}

func (m *bleManager) state() bleStateResponse {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.connection == nil {
		return bleStateResponse{Connected: false}
	}
	return bleStateResponse{
		Connected: true,
		Device: &bleDeviceInfo{
			Address: m.connection.address,
			Name:    m.connection.name,
		},
	}
}

func (m *bleManager) writeCharacteristic(serviceUUID, characteristicUUID string, payload []byte) error {
	conn, err := m.requireConnection()
	if err != nil {
		return err
	}
	if err := m.waitForConnectionReady(conn); err != nil {
		return err
	}

	conn.opMu.Lock()
	defer conn.opMu.Unlock()

	char, key, err := m.getCharacteristicLocked(conn, serviceUUID, characteristicUUID)
	if err != nil {
		return err
	}

	if _, err := char.WriteWithoutResponse(payload); err == nil {
		return nil
	}
	if _, err := char.Write(payload); err == nil {
		return nil
	} else {
		return fmt.Errorf("写入特征失败 %s: %w", key, err)
	}
}

func (m *bleManager) enableNotifications(serviceUUID, characteristicUUID string) error {
	conn, err := m.requireConnection()
	if err != nil {
		return err
	}
	if err := m.waitForConnectionReady(conn); err != nil {
		return err
	}

	conn.opMu.Lock()
	defer conn.opMu.Unlock()

	char, key, err := m.getCharacteristicLocked(conn, serviceUUID, characteristicUUID)
	if err != nil {
		return err
	}
	if conn.notifyState[key] {
		return nil
	}

	normalizedServiceUUID, err := normalizeUUID(serviceUUID)
	if err != nil {
		return err
	}
	normalizedCharUUID, err := normalizeUUID(characteristicUUID)
	if err != nil {
		return err
	}

	if err := char.EnableNotifications(func(buf []byte) {
		copyBuf := append([]byte(nil), buf...)
		m.broadcast(bleEvent{
			Type:               "notification",
			Timestamp:          time.Now().Format(time.RFC3339Nano),
			Address:            conn.address,
			Name:               conn.name,
			ServiceUUID:        normalizedServiceUUID,
			CharacteristicUUID: normalizedCharUUID,
			Data:               base64.StdEncoding.EncodeToString(copyBuf),
		})
	}); err != nil {
		return fmt.Errorf("开启通知失败 %s: %w", key, err)
	}

	conn.notifyState[key] = true
	return nil
}

func (m *bleManager) requireConnection() (*bleConnection, error) {
	m.mu.Lock()
	conn := m.connection
	m.mu.Unlock()
	if conn == nil {
		return nil, errors.New("当前没有已连接设备")
	}
	return conn, nil
}

func (m *bleManager) waitForConnectionReady(conn *bleConnection) error {
	if conn == nil {
		return errors.New("no active BLE connection")
	}

	if remaining := bleConnectionReadyDelay - time.Since(conn.connectedAt); remaining > 0 {
		time.Sleep(remaining)
	}

	m.mu.Lock()
	current := m.connection
	m.mu.Unlock()
	if current != conn {
		return errors.New("BLE connection changed, please reconnect")
	}
	return nil
}

func (m *bleManager) getCharacteristicLocked(conn *bleConnection, serviceUUID, characteristicUUID string) (bluetooth.DeviceCharacteristic, string, error) {
	normalizedServiceUUID, err := normalizeUUID(serviceUUID)
	if err != nil {
		return bluetooth.DeviceCharacteristic{}, "", err
	}
	normalizedCharUUID, err := normalizeUUID(characteristicUUID)
	if err != nil {
		return bluetooth.DeviceCharacteristic{}, "", err
	}

	key := normalizedServiceUUID + "|" + normalizedCharUUID
	if cached, ok := conn.charCache[key]; ok {
		return cached, key, nil
	}

	serviceID, err := bluetooth.ParseUUID(normalizedServiceUUID)
	if err != nil {
		return bluetooth.DeviceCharacteristic{}, key, fmt.Errorf("无效 service UUID: %w", err)
	}
	charID, err := bluetooth.ParseUUID(normalizedCharUUID)
	if err != nil {
		return bluetooth.DeviceCharacteristic{}, key, fmt.Errorf("无效 characteristic UUID: %w", err)
	}

	services, err := discoverServicesWithRetry(conn.device, []bluetooth.UUID{serviceID})
	if err != nil {
		return bluetooth.DeviceCharacteristic{}, key, fmt.Errorf("发现服务失败: %w", err)
	}
	if len(services) == 0 {
		return bluetooth.DeviceCharacteristic{}, key, fmt.Errorf("未找到服务 %s", normalizedServiceUUID)
	}

	chars, err := discoverCharacteristicsWithRetry(services[0], []bluetooth.UUID{charID})
	if err != nil {
		return bluetooth.DeviceCharacteristic{}, key, fmt.Errorf("发现特征失败: %w", err)
	}
	if len(chars) == 0 {
		return bluetooth.DeviceCharacteristic{}, key, fmt.Errorf("未找到特征 %s", normalizedCharUUID)
	}

	conn.charCache[key] = chars[0]
	return chars[0], key, nil
}

func discoverServicesWithRetry(device bluetooth.Device, filter []bluetooth.UUID) ([]bluetooth.DeviceService, error) {
	var lastErr error
	for attempt := 0; attempt < bleDiscoveryAttempts; attempt += 1 {
		services, err := device.DiscoverServices(filter)
		if err == nil {
			return services, nil
		}
		lastErr = err
		if attempt < bleDiscoveryAttempts-1 {
			time.Sleep(bleDiscoveryBackoff * time.Duration(attempt+1))
		}
	}
	return nil, lastErr
}

func discoverCharacteristicsWithRetry(service bluetooth.DeviceService, filter []bluetooth.UUID) ([]bluetooth.DeviceCharacteristic, error) {
	var lastErr error
	for attempt := 0; attempt < bleDiscoveryAttempts; attempt += 1 {
		chars, err := service.DiscoverCharacteristics(filter)
		if err == nil {
			return chars, nil
		}
		lastErr = err
		if attempt < bleDiscoveryAttempts-1 {
			time.Sleep(bleDiscoveryBackoff * time.Duration(attempt+1))
		}
	}
	return nil, lastErr
}

func normalizeUUID(raw string) (string, error) {
	value := strings.TrimSpace(strings.ToLower(raw))
	if value == "" {
		return "", errors.New("UUID 不能为空")
	}
	uuid, err := bluetooth.ParseUUID(value)
	if err != nil {
		return "", err
	}
	return strings.ToLower(uuid.String()), nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
