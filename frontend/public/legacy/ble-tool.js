// document.addEventListener('DOMContentLoaded', () => { if (prompt("请输入访问密码：") !== 'satellai') document.body.innerHTML = ''; });
        uuidSvcSatellai = '00000001-ffff-4fff-8fff-5a7e11a1ffff';
        uuidCharApp = '00000002-ffff-4fff-8fff-5a7e11a1ffff';
        uuidCharDfu = '00000005-ffff-4fff-8fff-5a7e11a1ffff';
        uuidCharRtt = '00000008-ffff-4fff-8fff-5a7e11a1ffff';
        uuidCharTransport = '0000000e-ffff-4fff-8fff-5a7e11a1ffff';
        uuidSvcNus = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
        uuidCharWrite = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
        uuidCharNotify = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

        const bleApiBase = '/api/ble';
        let bleScanResults = [];
        let bleEventSource = null;
        let bleScanLoopActive = false;
        let bleScanLoopRunId = 0;
        const BLE_NAME_FILTER_STORAGE_KEY = 'ble_web_tool.name_filter';

        function loadSavedNameFilter() {
            const input = document.getElementById('nameFilter');
            if (!input) return;
            try {
                const saved = localStorage.getItem(BLE_NAME_FILTER_STORAGE_KEY);
                if (saved !== null) {
                    input.value = saved;
                }
            } catch (error) {
                console.warn('[WARN] Failed to load BLE name filter:', error);
            }
        }

        function saveNameFilter(value) {
            try {
                localStorage.setItem(BLE_NAME_FILTER_STORAGE_KEY, value || '');
            } catch (error) {
                console.warn('[WARN] Failed to save BLE name filter:', error);
            }
        }

        function normalizeBleUuid(uuid) {
            return String(uuid || '').trim().toLowerCase();
        }

        function makeBleNotificationKey(serviceUuid, characteristicUuid) {
            return `${normalizeBleUuid(serviceUuid)}|${normalizeBleUuid(characteristicUuid)}`;
        }

        function setConnectionStatus(text, color = 'red') {
            const status = document.getElementById('status');
            status.innerText = text;
            status.style.color = color;
        }

        function formatConnectedDeviceLabel(device) {
            if (!device) {
                return '设备';
            }

            const name = device.name || '设备';
            const address = (device.address || '').toUpperCase();
            if (!address) {
                return name;
            }

            const parts = address.split(':');
            const shortAddress = parts.length >= 2 ? parts.slice(-2).join(':') : address;
            return `${name} · ${shortAddress}`;
        }

        function setBleConnectionControls(connected) {
            const nameFilter = document.getElementById('nameFilter');
            const scanButton = document.getElementById('scanDevices');
            const deviceSelect = document.getElementById('deviceSelect');
            const connectButton = document.getElementById('scanAndConnect');
            const disconnectButton = document.getElementById('disconnect');
            const summary = document.getElementById('deviceSummary');

            nameFilter.hidden = connected;
            scanButton.hidden = connected;
            deviceSelect.hidden = connected;
            connectButton.hidden = connected;
            disconnectButton.hidden = !connected;

            scanButton.disabled = connected;
            deviceSelect.disabled = connected || bleScanResults.length === 0;
            connectButton.disabled = connected || bleScanResults.length === 0;
            disconnectButton.disabled = !connected;
            summary.hidden = connected;

            if (connected) {
                summary.innerText = '';
            } else if (bleScanResults.length > 0) {
                summary.innerText = `已扫描到 ${bleScanResults.length} 台设备，选择后即可连接。`;
            } else {
                summary.innerText = '请先扫描设备，列表会显示名称、MAC 和 RSSI。';
            }
        }

        async function applySyncedBleConnectionState(device) {
            if (!device || !device.address) {
                return;
            }

            peripheral.device = {
                address: device.address,
                name: device.name || device.address,
                gatt: {
                    connected: true
                }
            };

            setConnectionStatus(`已连接 · ${formatConnectedDeviceLabel(peripheral.device)}`, 'green');
            setBleConnectionControls(true);
            try {
                await startDefaultBleNotifications();
                document.querySelectorAll('.cmd').forEach(btn => btn.disabled = false);
            } catch (error) {
                console.error('[ERROR] Failed to restore BLE notifications:', error);
                setConnectionStatus('已连接，但通知恢复失败，请重新连接', 'red');
                document.querySelectorAll('.cmd').forEach(btn => btn.disabled = true);
            }
        }

        function resetBleConnectionState() {
            peripheral.device = null;
            peripheral.notificationListeners.clear();
            peripheral.notificationSubscriptions.clear();
            setConnectionStatus('待连接', '#6b7280');
            setBleConnectionControls(false);
            document.querySelectorAll('.cmd').forEach(btn => btn.disabled = true);
        }

        async function syncBleStateFromBackend() {
            try {
                const state = await bleApiRequest(`${bleApiBase}/state`);
                if (state && state.connected && state.device) {
                    await applySyncedBleConnectionState(state.device);
                    return state;
                }

                resetBleConnectionState();
                return state;
            } catch (error) {
                console.warn('[WARN] 同步蓝牙连接状态失败:', error);
                return null;
            }
        }

        async function bleApiRequest(path, options = {}) {
            const response = await fetch(path, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                },
                ...options
            });

            const rawText = await response.text();
            let payload = null;
            if (rawText) {
                try {
                    payload = JSON.parse(rawText);
                } catch (error) {
                    payload = null;
                }
            }

            if (!response.ok) {
                throw new Error(payload && payload.error ? payload.error : (rawText || `HTTP ${response.status}`));
            }

            return payload;
        }

        function encodeBase64FromBytes(data) {
            let bytes = data;
            if (typeof bytes === 'string') {
                bytes = new TextEncoder().encode(bytes);
            } else if (bytes instanceof ArrayBuffer) {
                bytes = new Uint8Array(bytes);
            } else if (ArrayBuffer.isView(bytes)) {
                bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            }

            if (!(bytes instanceof Uint8Array)) {
                throw new Error('无法编码当前数据类型');
            }

            let binary = '';
            const chunkSize = 0x8000;
            for (let index = 0; index < bytes.length; index += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
            }
            return btoa(binary);
        }

        function decodeBase64ToDataView(encoded) {
            const binary = atob(encoded || '');
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) {
                bytes[index] = binary.charCodeAt(index);
            }
            return new DataView(bytes.buffer);
        }

        function getSelectedBleDevice() {
            const select = document.getElementById('deviceSelect');
            return bleScanResults.find(device => device.address === select.value) || null;
        }

        function renderBleDeviceOptions() {
            const select = document.getElementById('deviceSelect');
            const selectedAddress = select.value;

            select.innerHTML = '';
            if (bleScanResults.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = '未扫描到匹配设备';
                select.appendChild(option);
                setBleConnectionControls(isDeviceConnected());
                if (!isDeviceConnected()) {
                    document.getElementById('deviceSummary').innerText = '未扫描到匹配设备，请调整名称前缀后重试。';
                }
                return;
            }

            bleScanResults.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.address;
                const name = device.name || '(无名称)';
                option.textContent = `${name} | ${device.address} | RSSI ${device.rssi}`;
                if (selectedAddress ? device.address === selectedAddress : index === 0) option.selected = true;
                select.appendChild(option);
            });

            setBleConnectionControls(isDeviceConnected());
        }

        function setScanUiState(scanning) {
            const scanButton = document.getElementById('scanDevices');
            bleScanLoopActive = scanning;
            scanButton.disabled = false;
            scanButton.innerText = scanning ? '停止扫描' : '扫描设备';
        }

        function mergeBleScanResults(devices) {
            if (!Array.isArray(devices)) return;
            const deviceMap = new Map(bleScanResults.map(device => [device.address, device]));
            devices.forEach(device => {
                if (!device || !device.address) return;
                deviceMap.set(device.address, device);
            });
            bleScanResults = Array.from(deviceMap.values()).sort((left, right) => {
                if (left.rssi === right.rssi) {
                    return left.address.localeCompare(right.address);
                }
                return right.rssi - left.rssi;
            });
        }

        async function stopBleScanLoop() {
            bleScanLoopActive = false;
            bleScanLoopRunId += 1;
            setScanUiState(false);
        }

        async function scanBleDevices() {
            const prefixInput = document.getElementById('nameFilter');
            const prefix = prefixInput.value.trim() || 'SATELLAI';
            saveNameFilter(prefixInput.value.trim());
            const state = await syncBleStateFromBackend();

            if (state && state.connected) {
                return;
            }

            if (bleScanLoopActive) {
                await stopBleScanLoop();
                setConnectionStatus('已停止扫描', '#6b7280');
                return;
            }

            bleScanResults = [];
            renderBleDeviceOptions();
            setScanUiState(true);
            setConnectionStatus('扫描中，列表会实时刷新...', '#2563eb');

            const runId = ++bleScanLoopRunId;
            while (bleScanLoopActive && runId === bleScanLoopRunId) {
                try {
                    const query = new URLSearchParams({
                        prefix,
                        timeout_ms: '1000'
                    });
                    const response = await bleApiRequest(`${bleApiBase}/scan?${query.toString()}`);
                    if (runId !== bleScanLoopRunId || !bleScanLoopActive) {
                        break;
                    }
                    mergeBleScanResults(response && response.devices);
                    renderBleDeviceOptions();
                    if (bleScanResults.length > 0) {
                        setConnectionStatus(`扫描中: 已发现 ${bleScanResults.length} 台设备`, '#2563eb');
                    }
                } catch (error) {
                    if (runId !== bleScanLoopRunId) {
                        break;
                    }
                    if ((error.message || '').includes('扫描前请先断开当前设备')) {
                        const refreshedState = await syncBleStateFromBackend();
                        if (refreshedState && refreshedState.connected) {
                            break;
                        }
                    }
                    console.error('[ERROR] 蓝牙扫描失败:', error);
                    setConnectionStatus(`扫描失败: ${error.message || error}`, 'red');
                    break;
                }
            }

            if (runId === bleScanLoopRunId) {
                setScanUiState(false);
                if (isDeviceConnected()) {
                    return;
                }
                if (bleScanResults.length > 0) {
                    setConnectionStatus(`扫描完成: ${bleScanResults.length} 台设备`, '#2563eb');
                } else if (!document.getElementById('status').innerText.startsWith('扫描失败')) {
                    setConnectionStatus('未扫描到设备', 'red');
                }
            }
        }

        function ensureBleEventSource() {
            if (bleEventSource) return;

            bleEventSource = new EventSource(`${bleApiBase}/events`);
            bleEventSource.addEventListener('notification', event => {
                try {
                    peripheral.dispatchNotification(JSON.parse(event.data));
                } catch (error) {
                    console.error('[ERROR] 解析通知事件失败:', error);
                }
            });
            bleEventSource.addEventListener('transport_debug', event => {
                try {
                    appendBleTransportDebugLog(JSON.parse(event.data));
                } catch (error) {
                    console.error('[ERROR] 解析大包传输调试事件失败:', error);
                }
            });
            bleEventSource.addEventListener('disconnected', event => {
                try {
                    peripheral.handleBackendDisconnect(JSON.parse(event.data));
                } catch (error) {
                    peripheral.handleBackendDisconnect(null);
                }
            });
            bleEventSource.onerror = error => {
                console.warn('[WARN] BLE 事件流异常，浏览器会自动重连。', error);
            };
        }

        class Peripheral {
            constructor() {
                this.device = null;
                this.transportReady = false;
                this.notificationListeners = new Map();
                this.notificationSubscriptions = new Set();
                this.onDisconnected = this.onDisconnected.bind(this);
                ensureBleEventSource();
            }

            async request() {
                const selected = getSelectedBleDevice();
                if (!selected) throw new Error('请先扫描并选择设备');
                this.device = {
                    address: selected.address,
                    name: selected.name || selected.address,
                    gatt: {
                        connected: false
                    }
                };
            }

            async connect() {
                if (!this.device || !this.device.address) {
                    throw new Error('请先扫描并选择设备');
                }
                const response = await bleApiRequest(`${bleApiBase}/connect`, {
                    method: 'POST',
                    body: JSON.stringify({ address: this.device.address })
                });
                const device = response && response.device ? response.device : this.device;
                this.device = {
                    address: device.address,
                    name: device.name || this.device.name,
                    gatt: {
                        connected: true
                    }
                };
                this.transportReady = false;
                console.log('[INFO]CONNECTED');
                setConnectionStatus(`已连接 · ${formatConnectedDeviceLabel(this.device)}`, 'green');
                setBleConnectionControls(true);
                document.querySelectorAll('.cmd').forEach(btn => btn.disabled = false);
                document.querySelectorAll('.rsp').forEach(lbl => lbl.innerText = '');
            }

            disconnect() {
                fetch(`${bleApiBase}/disconnect`, { method: 'POST' })
                    .catch(error => console.warn('[WARN] 断开设备请求失败:', error))
                    .finally(() => this.onDisconnected());
            }

            onDisconnected() {
                console.log('[WARN]DISCONNECTED');
                flushPendingAppResponse();
                pendingCommands.forEach(commandInfo => {
                    if (commandInfo.reject) {
                        commandInfo.reject(new Error('设备已断开连接'));
                    }
                });
                pendingCommands.clear();
                setConnectionStatus('待连接', '#6b7280');
                setBleConnectionControls(false);
                document.querySelectorAll('.cmd').forEach(btn => btn.disabled = true);
                this.notificationListeners.clear();
                this.notificationSubscriptions.clear();
                this.transportReady = false;
                appJsonFragmentBuffers.clear();
                this.device = null;
            }

            handleBackendDisconnect(payload) {
                if (!this.device) {
                    this.onDisconnected();
                    return;
                }
                if (!payload || !payload.address || payload.address === this.device.address) {
                    this.onDisconnected();
                }
            }

            dispatchNotification(payload) {
                const key = makeBleNotificationKey(payload.serviceUuid, payload.characteristicUuid);
                const listeners = this.notificationListeners.get(key);
                if (!listeners || listeners.size === 0) return;

                const syntheticEvent = {
                    target: {
                        value: decodeBase64ToDataView(payload.data),
                        transportChannel: payload.transportChannel
                    }
                };

                listeners.forEach(listener => {
                    try {
                        listener(syntheticEvent);
                    } catch (error) {
                        console.error('[ERROR] 处理通知回调失败:', error);
                    }
                });
            }

            async sendCmd(svc, ch, data) {
                if (!this.device || !this.device.gatt || !this.device.gatt.connected) {
                    throw new Error('设备未连接，无法发送指令');
                }
                await bleApiRequest(`${bleApiBase}/write`, {
                    method: 'POST',
                    body: JSON.stringify({
                        serviceUuid: svc,
                        characteristicUuid: ch,
                        data: encodeBase64FromBytes(data)
                    })
                });
            }

            async startCmdNotifications(svc, ch, listener) {
                if (!this.device || !this.device.gatt || !this.device.gatt.connected) {
                    throw new Error('设备未连接，无法订阅通知');
                }
                const key = makeBleNotificationKey(svc, ch);
                if (!this.notificationListeners.has(key)) {
                    this.notificationListeners.set(key, new Set());
                }
                this.notificationListeners.get(key).add(listener);

                if (!this.notificationSubscriptions.has(key)) {
                    await bleApiRequest(`${bleApiBase}/subscribe`, {
                        method: 'POST',
                        body: JSON.stringify({
                            serviceUuid: svc,
                            characteristicUuid: ch
                        })
                    });
                    this.notificationSubscriptions.add(key);
                }
            }

            async stopCmdNotifications(svc, ch, listener) {
                const key = makeBleNotificationKey(svc, ch);
                if (!this.notificationListeners.has(key)) return;
                this.notificationListeners.get(key).delete(listener);
                if (this.notificationListeners.get(key).size === 0) {
                    this.notificationListeners.delete(key);
                }
            }
        }

        const peripheral = new Peripheral();
    loadSavedNameFilter();
    document.getElementById('nameFilter').addEventListener('input', event => {
        saveNameFilter(event.target.value.trim());
    });
    resetBleConnectionState();
    syncBleStateFromBackend();

        const wifiConstants = {
            stateMap: {
                0: '未扫描到信标',
                1: '已扫描到信标',
                2: '信标功能未开启'
            },
            encryptionMap: {
                0: 'OPEN',
                1: 'WEP',
                2: 'WPA_PSK',
                3: 'WPA2_PSK',
                4: 'WPA_WPA2_PSK',
                5: 'WPA2_ENTERPRISE',
                6: 'WPA3_PSK',
                7: 'WPA2_WPA3_PSK',
                8: 'WAPI_PSK',
                9: 'OWE'
            },
            addResultMap: {
                0: '添加成功',
                1: '失败：信标已满',
                2: '未知错误'
            },
            delResultMap: {
                0: '删除成功',
                1: '未找到该信标',
                2: '未知错误'
            }
        };

        function appendLog(element, text, direction = '>') {
            if (!element || text === undefined || text === null) return;
            const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const segments = normalized.split('\n');
            segments.forEach((segment, index) => {
                const isLast = index === segments.length - 1;
                const endsWithLineBreak = !isLast || normalized.endsWith('\n');
                const hasContent = segment.length > 0;
                if (hasContent) {
                    if (!element.innerText || element.innerText.endsWith('\n')) {
                        element.innerText += `${timestamp()}${direction} `;
                    }
                    element.innerText += segment;
                }
                if (endsWithLineBreak) {
                    if (!element.innerText.endsWith('\n')) {
                        element.innerText += '\n';
                    }
                }
            });
        }

        function appendLogLine(element, text, direction = '>') {
            const value = String(text ?? '');
            appendLog(element, /[\r\n]$/.test(value) ? value : `${value}\n`, direction);
        }

        let resolveDfu = null;

        const DEFAULT_APP_RESPONSE_TIMEOUT = 400;
        const DEFAULT_APP_RESPONSE_MAX_WAIT = 5000;
        const APP_JSON_FRAGMENT_BUFFER_MAX_BYTES = 16 * 1024;
        let pendingAppResponse = null;
        const appJsonFragmentBuffers = new Map();
        const pendingCommands = new Map();
        let commandIdCounter = 0;

        function generateCommandId() {
            return `cmd_${++commandIdCounter}_${Date.now()}`;
        }

        function isDeviceConnected() {
            return peripheral.device && peripheral.device.gatt && peripheral.device.gatt.connected;
        }

        function clearEventMessages() {
            const eventLbl = document.getElementById('eventMessagesLog');
            if (eventLbl) {
                eventLbl.innerText = '';
            }
        }

        function flushPendingAppResponse() {
            if (!pendingAppResponse) return;
            const { resolve, buffer, inactivityTimer, overallTimer } = pendingAppResponse;
            if (inactivityTimer) clearTimeout(inactivityTimer);
            if (overallTimer) clearTimeout(overallTimer);
            pendingAppResponse = null;
            resolve(buffer);
        }

        // 判断响应缓冲区里是否已出现所等待命令的同步响应（`{"c": ...}`）。
        // 只匹配第一个 `c` 命令响应；事件（`{"e": ...}`）、错误响应（`c` + 数值/对象 `e`）
        // 也会一并触发立即 flush，避免响应行被后续连续事件推迟打印。
        function responseBufferMatchesCommand(buffer, expectedCommand) {
            if (!expectedCommand || typeof expectedCommand !== 'string') return false;
            const payloads = parseMultipleJsonResponses(buffer || '');
            return payloads.some(payload => payload && typeof payload === 'object' && payload.c === expectedCommand);
        }

        function appendAppDebugLog(message) {
            const log = document.getElementById('appCmdRspLog');
            if (!log) return;
            appendLogLine(log, message, '>');
            log.scrollTop = log.scrollHeight;
        }

        function handleAppJsonNotificationText(text, source = 'APP') {
            const responses = dispatchEsimPayloads(parseBufferedJsonResponses(text, source), source);
            responses.forEach(response => {
                if (response.e !== undefined) {
                    const eventLbl = document.getElementById('eventMessagesLog');
                    if (eventLbl) {
                        appendLogLine(eventLbl, JSON.stringify(response), '>');
                        eventLbl.scrollTop = eventLbl.scrollHeight;
                    }

                    if (response.e === 'wifi-scan') {
                        handleWifiScanEvent(response);
                    }

                    if (response.e === 'ntn_state' || response.e === 'ntn_sms_tx' || response.e === 'ntn_sms_rx') {
                        handleNtnEvent(response);
                    }

                    if (response.e === 'esim-pending') {
                        handleEsimPendingEvent(response);
                    }
                }
            });
            return responses;
        }

        function appendBleTransportDebugLog(payload) {
            const debug = payload && payload.transportDebug;
            if (!debug) return;

            const log = document.getElementById('appCmdRspLog');
            if (!log) return;

            const parts = [
                `TP-RX ${debug.phase || 'frame'}`,
                `ch=${debug.channel}`,
                `msg=${debug.msgId}`,
                `seq=${debug.seq}`,
                `sof=${debug.sof ? 1 : 0}`,
                `eof=${debug.eof ? 1 : 0}`,
                `frame=${debug.frameLen}`,
            ];
            if (debug.chunkLen !== undefined) parts.push(`chunk=${debug.chunkLen}`);
            if (debug.total !== undefined && debug.total !== 0) parts.push(`got=${debug.got || 0}/${debug.total}`);
            if (debug.status) parts.push(`status=${debug.status}`);

            appendLogLine(log, parts.join(' '), '>');
            log.scrollTop = log.scrollHeight;
        }

        function handleBleTransportNotification(event) {
            const text = new TextDecoder().decode(event.target.value);
            const channel = event.target.transportChannel;
            const appLbl = document.getElementById('appCmdRspLog');
            if (appLbl) {
                appendLogLine(appLbl, `TP[CH=${channel ?? '?'}]: ${text}`, '>');
                appLbl.scrollTop = appLbl.scrollHeight;
            }
            if (channel === 3 || channel === 6) {
                try {
                    handleAppJsonNotificationText(text, `TP[CH=${channel}]`);
                } catch (error) {
                    console.debug('解析 TRANSPORT eSIM 事件失败:', error);
                }
            }
        }

        async function ensureBleTransportNotifications() {
            await peripheral.startCmdNotifications(uuidSvcSatellai, uuidCharTransport, handleBleTransportNotification);
            peripheral.transportReady = true;
        }

        async function startDefaultBleNotifications() {
            peripheral.notificationListeners.clear();
            peripheral.notificationSubscriptions.clear();
            peripheral.transportReady = false;
            appJsonFragmentBuffers.clear();

            try {
                await ensureBleTransportNotifications();
                console.info('[BLE] transport ccc subscribed');
                const appLbl = document.getElementById('appCmdRspLog');
                if (appLbl) {
                    appendLogLine(appLbl, 'TRANSPORT CCC subscribed: 0000000e-ffff-4fff-8fff-5a7e11a1ffff', '>');
                    appLbl.scrollTop = appLbl.scrollHeight;
                }
            } catch (error) {
                peripheral.transportReady = false;
                console.warn('[WARN] 设备未开放 BLE TRANSPORT 特征，已按老固件小包模式继续:', error);
                const appLbl = document.getElementById('appCmdRspLog');
                if (appLbl) {
                    appendLogLine(appLbl, `TRANSPORT CCC subscribe failed: ${error.message || error}`, '>');
                    appLbl.scrollTop = appLbl.scrollHeight;
                }
            }

            await peripheral.startCmdNotifications(uuidSvcNus, uuidCharNotify, event => {
                const text = new TextDecoder().decode(event.target.value);
                const lbl = document.getElementById('customCmdRsp');
                if (lbl) {
                    appendLog(lbl, text, '>');
                    lbl.scrollTop = lbl.scrollHeight;
                }

                if (pendingCommands.size > 0) {
                    const [commandId, commandInfo] = pendingCommands.entries().next().value;
                    commandInfo.response += text;
                    commandInfo.lastActivityTime = Date.now();

                    if (commandInfo.response.endsWith('OK\r\n') || commandInfo.response.endsWith('ERROR\r\n')) {
                        if (commandInfo.resolve) {
                            commandInfo.resolve(commandInfo.response);
                        }
                        pendingCommands.delete(commandId);
                    }
                }
            });

            await peripheral.startCmdNotifications(uuidSvcSatellai, uuidCharApp, event => {
                const text = new TextDecoder().decode(event.target.value);
                const channel = event.target.transportChannel;
                const source = channel === undefined || channel === null ? 'APP' : `TP[CH=${channel}]`;
                const isWaitingForAppResponse = Boolean(pendingAppResponse);

                const appLbl = document.getElementById('appCmdRspLog');
                if (appLbl && !isWaitingForAppResponse) {
                    appendLogLine(appLbl, source === 'APP' ? text : `${source}: ${text}`, '>');
                    appLbl.scrollTop = appLbl.scrollHeight;
                }

                try {
                    handleAppJsonNotificationText(text, source);
                } catch (error) {
                    console.debug('解析事件失败:', error);
                }

                if (pendingAppResponse) {
                    pendingAppResponse.buffer += text;
                    // 已经收到所等待命令的同步响应就立即结束本次响应收集，
                    // 不必再等静默超时；避免后续连续事件把响应行推迟到下一条命令才打印。
                    if (responseBufferMatchesCommand(pendingAppResponse.buffer, pendingAppResponse.expectedCommand)) {
                        flushPendingAppResponse();
                    } else {
                        if (pendingAppResponse.inactivityTimer) clearTimeout(pendingAppResponse.inactivityTimer);
                        pendingAppResponse.inactivityTimer = setTimeout(() => {
                            flushPendingAppResponse();
                        }, pendingAppResponse.inactivityMs);
                    }
                }
            });

            await peripheral.startCmdNotifications(uuidSvcSatellai, uuidCharDfu, event => {
                if (resolveDfu) {
                    resolveDfu(event.target.value);
                    resolveDfu = null;
                } else {
                    console.warn(event.target.value);
                }
            });
        }

        const scanDevicesButton = document.getElementById('scanDevices');
        if (scanDevicesButton && !scanDevicesButton.dataset.vueAction) {
            scanDevicesButton.addEventListener('click', async () => {
                await scanBleDevices();
            });
        }

        async function connectSelectedDevice() {
            try {
                if (bleScanLoopActive) {
                    await stopBleScanLoop();
                }
                await peripheral.request();
                await peripheral.connect();
                await startDefaultBleNotifications();
            } catch (error) {
                console.error('[ERROR] 设备连接或订阅失败:', error);
                
                // 清理所有待处理的命令
                pendingCommands.forEach((commandInfo, commandId) => {
                    if (commandInfo.reject) {
                        commandInfo.reject(new Error('设备连接失败'));
                    }
                });
                pendingCommands.clear();
                
                flushPendingAppResponse();
                if (peripheral.device && peripheral.device.gatt && peripheral.device.gatt.connected) {
                    try { await bleApiRequest(`${bleApiBase}/disconnect`, { method: 'POST' }); } catch (e) { console.warn(e); }
                }
                peripheral.device = null;
                setConnectionStatus('连接失败，请重试', 'red');
                setBleConnectionControls(false);
                document.querySelectorAll('.cmd').forEach(btn => btn.disabled = true);
            }
        }

        const scanAndConnectButton = document.getElementById('scanAndConnect');
        if (scanAndConnectButton && !scanAndConnectButton.dataset.vueAction) {
            scanAndConnectButton.addEventListener('click', connectSelectedDevice);
        }

        function timestamp() {
            const now = new Date();
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            const millis = String(now.getMilliseconds()).padStart(3, '0');
            return `${hours}:${minutes}:${seconds}.${millis}`; }

        document.getElementById('customCmd').addEventListener('keyup', async event => {
            if (event.key === 'Enter') {
                let cmd = event.target.value.trim();
                if (!cmd) return;
                const addCrLf = document.getElementById('clearOnSent').checked;
                if (addCrLf) cmd += '\r\n';
                const lbl = document.getElementById('customCmdRsp');
                if (!isDeviceConnected()) {
                    if (lbl) {
                        appendLog(lbl, 'ERROR(NUS): 设备未连接，无法发送命令\n', '>');
                        lbl.scrollTop = lbl.scrollHeight;
                    }
                    return;
                }
                if (lbl) {
                    appendLog(lbl, `SENT(NUS): ${cmd}\n`, '<');
                    lbl.scrollTop = lbl.scrollHeight;
                }
                setTimeout(async () => {
                    try {
                        await peripheral.sendCmd(uuidSvcNus, uuidCharWrite, cmd);
                    } catch (error) {
                        console.error('[ERROR] 自定义命令发送失败:', error);
                        if (lbl) {
                            appendLog(lbl, `ERROR(NUS): ${error.message || error}\n`, '>');
                            lbl.scrollTop = lbl.scrollHeight;
                        }
                    }
                }, 0);
                if (addCrLf) event.target.value = '';
            }
        });

        document.getElementById('appCmd').addEventListener('keyup', async event => {
            if (event.key === 'Enter') {
                let cmd = event.target.value.trim();
                if (!cmd) return;
                const lbl = document.getElementById('appCmdRspLog');
                if (!isDeviceConnected()) {
                    if (lbl) {
                        appendLog(lbl, 'ERROR(APP): 设备未连接，无法发送命令\n', '>');
                        lbl.scrollTop = lbl.scrollHeight;
                    }
                    return;
                }
                if (lbl) {
                    appendLog(lbl, `SENT(APP): ${cmd}\n`, '<');
                    lbl.scrollTop = lbl.scrollHeight;
                }
                setTimeout(async () => {
                    try {
                        await peripheral.sendCmd(uuidSvcSatellai, uuidCharApp, cmd);
                    } catch (error) {
                        console.error('[ERROR] APP命令发送失败:', error);
                        if (lbl) {
                            appendLog(lbl, `ERROR(APP): ${error.message || error}\n`, '>');
                            lbl.scrollTop = lbl.scrollHeight;
                        }
                    }
                }, 0);
                event.target.value = '';
            }
        });

        function disconnectBleDevice() {
            // 清理所有待处理的命令
            pendingCommands.forEach((commandInfo, commandId) => {
                if (commandInfo.reject) {
                    commandInfo.reject(new Error('设备已断开连接'));
                }
            });
            pendingCommands.clear();
            
            //忽略取消订阅
            peripheral.disconnect();
        }

        const disconnectButton = document.getElementById('disconnect');
        if (disconnectButton && !disconnectButton.dataset.vueAction) {
            disconnectButton.addEventListener('click', disconnectBleDevice);
        }

        function chooseFile(input) {
            console.log(input);
            const file = input.files[0];
            if (!file) { alert('请先选择固件文件'); return; }
            if (file) {
                console.log(file);
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const fileContent = new Uint8Array(e.target.result);
                    console.log(`fileContent.length=${fileContent.length}`);
                    const dest = file.name.includes('9160');
                    await firmware_upgrade(fileContent, dest);
                };
                reader.readAsArrayBuffer(file);
            }
        }

        function sendCert(input) {
            console.log(input);
            const file = input.files[0];
            if (!file) { alert('请先选择证书文件'); return; }
            if (file) {
                console.log(file);
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const fileContent = new Uint8Array(e.target.result);
                    console.log(`fileContent.length=${fileContent.length}`);
                    let type;
                    if (file.name.toLowerCase().includes('root')) type = 0;
                    else if (file.name.toLowerCase().includes('cert')) type = 1;
                    else if (file.name.toLowerCase().includes('key')) type = 2;
                    await cert_transfer(fileContent, type);
                };
                reader.readAsArrayBuffer(file);
            }
        }

        function sendFile(input) {
            console.log(input);
            const file = input.files[0];
            if (!file) { alert('请先选择要上传的文件'); return; }
            if (file) {
                console.log(file);
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const fileContent = new Uint8Array(e.target.result);
                    console.log(`fileContent.length=${fileContent.length}`);
                    const path = document.getElementById('genericfilePath').value;
                    await file_transfer(fileContent, (path?(path+'/'):'')+file.name);
                };
                reader.readAsArrayBuffer(file);
            }
        }

        async function file_transfer(content, name) {
            console.log(`[INFO]SEND START: ${name}`);
            const mtu = 247;
            const size = content.length;
            setTimeout(async () => {
                await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, new Uint8Array([1]));
            }, 0);
            let rsp = await new Promise(resolve => (resolveDfu = resolve));
            console.log(new Uint8Array(rsp.buffer)[0]);
            setTimeout(async () => {
                const arr = new Uint8Array(6 + name.length + 1);
                arr.set(new Uint8Array([124, 4+name.length+1, size, size>>8, size>>16, size>>24]));
                arr.set(new TextEncoder().encode(name), 6);
                arr.set(new Uint8Array([0]), 6+name.length);
                console.log(arr);
                await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, arr);
            }, 0);
            rsp = await new Promise(resolve => (resolveDfu = resolve));
            console.log(rsp.getUint8(0));
            let idx = 0;

            let crc = 0;
            async function send_buf(base, BLOCK_SIZE) {
                let offset = 0;
                while (offset < BLOCK_SIZE) {
                    let chunkSize = mtu-(mtu>255?4:3);
                    if (offset + chunkSize > BLOCK_SIZE) chunkSize = BLOCK_SIZE - offset;
                    const chunk = content.slice(base + offset, base + offset + chunkSize);
                    const arr = new Uint8Array(chunkSize+(mtu>255?4:3)).fill(0);
                    if (mtu>255) {arr[0] = 125|0x80; arr[1] = (chunkSize+1)&0xff; arr[2] = (chunkSize+1)>>8; arr[3] = idx; arr.set(chunk, 4);}
                    else {arr[0] = 125; arr[1] = chunkSize+1; arr[2] = idx; arr.set(chunk, 3);}
                    await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, arr); 
                    // rsp = await new Promise(resolve => (resolveDfu = resolve));
                    // console.log(rsp);
                    crc = crc8(chunk, crc);
                    // console.log(`id=${idx}, offset=${offset}, chunkSize=${chunkSize}, crc=0x${crc.toString(16)}`);
                    offset += chunkSize;
                    idx++;
                }
                setTimeout(async () => {
                    await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, new Uint8Array([126, 0]));
                }, 0);
                rsp = await new Promise(resolve => (resolveDfu = resolve));
                const crc_rsp = rsp.getUint8(0);
                if (crc_rsp !== crc) throw 'CRC ERROR';
                return offset;
            }
            const t0 = Date.now();
            let base = 0;
            while (base < size) {
                const left = size - base;
                // console.log(`base=${base}, left=${left}`);
                if (left <= 4096) {
                    base += await send_buf(base, left);
                    console.log(`progress: ${(base / size * 100).toFixed(2)}%`)
                    break;
                }
                base += await send_buf(base, 4096);
                console.log(`progress: ${(base / size * 100).toFixed(2)}%`)
            }
            const t1 = Date.now();
            setTimeout(async () => {
                await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, new Uint8Array([127, 0]));
            }, 0);
            rsp = await new Promise(resolve => (resolveDfu = resolve));
            console.log(rsp.getUint32(0, true));
            console.log(`[INFO]SENT ${size} BYTES in ${t1 - t0}ms, TRANSFER RATE: ${(size / (t1 - t0)).toFixed(1)} KB/s`);
        }

        async function cert_transfer(cert, type) {
            console.log('[INFO]SEND START');
            // const cert = new Uint8Array(10000);
            // cert.fill(0x5a);
            const mtu = 247;
            const size = cert.length;
            setTimeout(async () => {
                await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, new Uint8Array([1]));
            }, 0);
            let rsp = await new Promise(resolve => (resolveDfu = resolve));
            console.log(new Uint8Array(rsp.buffer)[0]);
            setTimeout(async () => {
                await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, new Uint8Array([120, 5, size, size>>8, size>>16, size>>24, type]));
            }, 0);
            rsp = await new Promise(resolve => (resolveDfu = resolve));
            console.log(new Uint8Array(rsp.buffer)[0]);
            let idx = 0;

            let crc = 0;
            async function send_buf(base, BLOCK_SIZE) {
                let offset = 0;
                while (offset < BLOCK_SIZE) {
                    let chunkSize = mtu-(mtu>255?4:3);
                    if (offset + chunkSize > BLOCK_SIZE) chunkSize = BLOCK_SIZE - offset;
                    const chunk = cert.slice(base + offset, base + offset + chunkSize);
                    const arr = new Uint8Array(chunkSize+(mtu>255?4:3)).fill(0);
                    if (mtu>255) {arr[0] = 11|0x80; arr[1] = (chunkSize+1)&0xff; arr[2] = (chunkSize+1)>>8; arr[3] = idx; arr.set(chunk, 4);}
                    else {arr[0] = 121; arr[1] = chunkSize+1; arr[2] = idx; arr.set(chunk, 3);}
                    await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, arr); 
                    // rsp = await new Promise(resolve => (resolveDfu = resolve));
                    // console.log(rsp);
                    crc = crc8(chunk, crc);
                    // console.log(`id=${idx}, offset=${offset}, crc=0x${crc.toString(16)}`);
                    offset += chunkSize;
                    idx++;
                }
                setTimeout(async () => {
                    await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, new Uint8Array([122, 0]));
                }, 0);
                rsp = await new Promise(resolve => (resolveDfu = resolve));
                // console.log(new Uint8Array(rsp.buffer)[0].toString(16));
                return offset;
            }
            const t0 = Date.now();
            let base = 0;
            while (base < size) {
                const left = size - base;
                // console.log(`base=${base}, left=${left}`);
                if (left <= 4096) {
                    base += await send_buf(base, left);
                    console.log(`progress: ${(base / size * 100).toFixed(2)}%`)
                    break;
                }
                base += await send_buf(base, 4096);
                console.log(`progress: ${(base / size * 100).toFixed(2)}%`)
            }
            const t1 = Date.now();
            setTimeout(async () => {
                await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, new Uint8Array([123, 0]));
            }, 0);
            rsp = ''
            while (true) {
                rsp += new TextDecoder().decode(await new Promise(resolve => (resolveDfu = resolve)));
                if (rsp.endsWith('OK\r\n')) break;
            }
            console.log(rsp);
            console.log(`[INFO]SENT ${size} BYTES in ${t1 - t0}ms, TRANSFER RATE: ${(size / (t1 - t0)).toFixed(1)} KB/s`);
        }

        async function firmware_upgrade(fw, dest) {
            console.log('[INFO]SEND START');
            // const fw = new Uint8Array(10000);
            // fw.fill(0x5a);
            const mtu = 247;
            const size = fw.length;
            setTimeout(async () => {
                await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, new Uint8Array([dest]));
            }, 0);
            let rsp = await new Promise(resolve => (resolveDfu = resolve));
            console.log(new Uint8Array(rsp.buffer)[0]);
            setTimeout(async () => {
                await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, new Uint8Array([10, 4, size, size>>8, size>>16, size>>24]));
            }, 0);
            rsp = await new Promise(resolve => (resolveDfu = resolve));
            console.log(new Uint8Array(rsp.buffer)[0]);
            let idx = 0;

            let crc = 0;
            async function send_buf(base, BLOCK_SIZE) {
                let offset = 0;
                while (offset < BLOCK_SIZE) {
                    let chunkSize = mtu-(mtu>255?4:3);
                    if (offset + chunkSize > BLOCK_SIZE) chunkSize = BLOCK_SIZE - offset;
                    const chunk = fw.slice(base + offset, base + offset + chunkSize);
                    const arr = new Uint8Array(chunkSize+(mtu>255?4:3)).fill(0);
                    if (mtu>255) {arr[0] = 11|0x80; arr[1] = (chunkSize+1)&0xff; arr[2] = (chunkSize+1)>>8; arr[3] = idx; arr.set(chunk, 4);}
                    else {arr[0] = 11; arr[1] = chunkSize+1; arr[2] = idx; arr.set(chunk, 3);}
                    await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, arr); 
                    // rsp = await new Promise(resolve => (resolveDfu = resolve));
                    // console.log(rsp);
                    crc = crc8(chunk, crc);
                    // console.log(`id=${idx}, offset=${offset}, crc=0x${crc.toString(16)}`);
                    offset += chunkSize;
                    idx++;
                }
                setTimeout(async () => {
                    await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, new Uint8Array([12, 0]));
                }, 0);
                rsp = await new Promise(resolve => (resolveDfu = resolve));
                // console.log(new Uint8Array(rsp.buffer)[0].toString(16));
                return offset;
            }
            const t0 = Date.now();
            let base = 0;
            const lbl = document.querySelector(`label[for="fwfile"]`);
            while (base < size) {
                const left = size - base;
                // console.log(`base=${base}, left=${left}`);
                if (left <= 4096) {
                    base += await send_buf(base, left);
                    console.log(`progress: ${(base / size * 100).toFixed(2)}%`)
                    lbl.innerText = `固件升级: ${(base / size * 100).toFixed(2)}%`;
                    break;
                }
                base += await send_buf(base, 4096);
                console.log(`progress: ${(base / size * 100).toFixed(2)}%`)
                lbl.innerText = `固件升级: ${(base / size * 100).toFixed(2)}%`;
            }
            const t1 = Date.now();
            setTimeout(async () => {
                await peripheral.sendCmd(uuidSvcSatellai, uuidCharDfu, new Uint8Array([13, 0]));
            }, 0);
            rsp = await new Promise(resolve => (resolveDfu = resolve));
            console.log(new Uint8Array(rsp.buffer)[0]);
            console.log(`[INFO]SENT ${size} BYTES in ${t1 - t0}ms, TRANSFER RATE: ${(size / (t1 - t0)).toFixed(1)} KB/s`);
        }

        // 通用的命令响应检测函数，使用命令跟踪机制
        async function waitForCmdResponse(command, timeout = 10000) {
            return new Promise((resolve, reject) => {
                // 生成唯一命令ID
                const commandId = generateCommandId();
                
                // 将命令添加到待处理列表
                pendingCommands.set(commandId, {
                    command: command,
                    response: '',
                    resolve: resolve,
                    reject: reject,
                    startTime: Date.now(),
                    lastActivityTime: Date.now()
                });
                
                // 设置超时定时器
                const timeoutTimer = setTimeout(() => {
                    if (pendingCommands.has(commandId)) {
                        pendingCommands.delete(commandId);
                        resolve('超时 - 未收到响应');
                    }
                }, timeout);
                
                // 定期检查命令是否超时（基于最后活动时间）
                const checkInterval = setInterval(() => {
                    if (pendingCommands.has(commandId)) {
                        const commandInfo = pendingCommands.get(commandId);
                        // 如果超过最后活动时间2秒没有新数据，认为命令已完成
                        if (Date.now() - commandInfo.lastActivityTime > 2000 && commandInfo.response.length > 0) {
                            clearInterval(checkInterval);
                            clearTimeout(timeoutTimer);
                            pendingCommands.delete(commandId);
                            resolve(commandInfo.response || '未收到完整响应');
                        }
                    } else {
                        // 命令已完成，清理定时器
                        clearInterval(checkInterval);
                        clearTimeout(timeoutTimer);
                    }
                }, 500);
            });
        }

        async function sendCmdAndWaitForOK(btn) {
            document.querySelectorAll('.cmd').forEach(btn => btn.disabled = true);
            const lbl = document.querySelector(`label[for="${btn.id}"]`);
            lbl.innerText = '执行中...'; lbl.style.color ='gray';
            setTimeout(async () => {
                await peripheral.sendCmd(uuidSvcNus, uuidCharWrite, btn.id); 
            }, 0);
            
            const rsp = await waitForCmdResponse(btn.id);
            
            lbl.innerText = rsp || '未收到有效响应';
            if (rsp.endsWith('OK\r\n')) lbl.style.color ='green';
            else if (rsp.endsWith('ERROR\r\n')) lbl.style.color ='red';
            else lbl.style.color = 'orange';
            
            document.querySelectorAll('.cmd').forEach(btn => btn.disabled = false);
        }

        const sensorRTTransferHandler = event => {
            const sensordata = new Uint8Array(event.target.value.buffer);
            console.log(sensordata[0]);
        };
        async function sensorRTTransfer(on) {
            if (on) {
                await peripheral.startCmdNotifications(uuidSvcSatellai, uuidCharRtt, sensorRTTransferHandler);
                await peripheral.sendCmd(uuidSvcNus, uuidCharWrite, 'AT+SENSOR=1');
            } else {
                await peripheral.sendCmd(uuidSvcNus, uuidCharWrite, 'AT+SENSOR=0');
                await peripheral.stopCmdNotifications(uuidSvcSatellai, uuidCharRtt, sensorRTTransferHandler);
            }
        }

        const gnssReceiveHandler = event => {
            console.log(new TextDecoder().decode(event.target.value));
        };
        async function gnssReceive(on) {
            if (on) {
                await peripheral.startCmdNotifications(uuidSvcSatellai, uuidCharRtt, gnssReceiveHandler);
                setTimeout(async () => {
                    await peripheral.sendCmd(uuidSvcNus, uuidCharWrite, 'AT+GNSS1TEST=1');                    
                }, 0);
                let rsp = await waitForCmdResponse('AT+GNSS1TEST=1');
                console.log(rsp);
            }
             else {
                setTimeout(async () => {
                    await peripheral.sendCmd(uuidSvcNus, uuidCharWrite, 'AT+GNSS1TEST=0');                    
                }, 0);
                let rsp = await waitForCmdResponse('AT+GNSS1TEST=0');
                console.log(rsp);
                await peripheral.stopCmdNotifications(uuidSvcSatellai, uuidCharRtt, gnssReceiveHandler);
            }
        }

        // New helper function to send app commands and display response
        async function sendAppCommandViaBle(jsonString, options = {}) {
            const {
                containerSelector = '#appAdvancedCommandsSection',
                logElementId = 'appCmdRspLog',
                labelPrefix = 'APP',
                responseTimeout = DEFAULT_APP_RESPONSE_TIMEOUT,
                maxWait = DEFAULT_APP_RESPONSE_MAX_WAIT
            } = options;

            if (!peripheral.device || !peripheral.device.gatt.connected) {
                const statusLabel = document.getElementById('status');
                statusLabel.innerText = "设备未连接 (Device not connected)";
                statusLabel.style.color = 'red';
                const logElement = document.getElementById(logElementId);
                if (logElement) {
                    appendLog(logElement, `ERROR(${labelPrefix}): 设备未连接\n`, '>');
                    logElement.scrollTop = logElement.scrollHeight;
                }
                return null;
            }

            const logElement = document.getElementById(logElementId);
            if (logElement) {
                appendLog(logElement, `SENT(${labelPrefix}): ${jsonString}\n`, '<');
                logElement.scrollTop = logElement.scrollHeight;
            }

            const controls = containerSelector
                ? Array.from(document.querySelectorAll(`${containerSelector} .cmd-button, ${containerSelector} .cmd-input, ${containerSelector} .cmd-textarea`))
                : [];
            controls.forEach(el => el.disabled = true);

            try {
                if (peripheral.device && peripheral.device.gatt && peripheral.device.gatt.connected) {
                    const responsePromise = new Promise(resolve => {
                        if (pendingAppResponse) flushPendingAppResponse();
                        const inactivityMs = Math.max(50, responseTimeout);
                        const overallMs = Math.max(inactivityMs, maxWait);
                        pendingAppResponse = {
                            resolve,
                            buffer: '',
                            inactivityTimer: null,
                            inactivityMs,
                            expectedCommand: options.expectedCommand || null,
                            overallTimer: setTimeout(() => {
                                flushPendingAppResponse();
                            }, overallMs)
                        };
                    });
                    await peripheral.sendCmd(uuidSvcSatellai, uuidCharApp, jsonString);
                    const rsp = await responsePromise;
                    if (logElement && String(rsp ?? '').length > 0) {
                        appendLog(logElement, `RESP(${labelPrefix}): ${rsp}\n`, '>');
                        logElement.scrollTop = logElement.scrollHeight;
                    }
                    return rsp;
                }
                throw new Error("Device disconnected before command could be fully processed.");
            } catch (error) {
                flushPendingAppResponse();
                if (logElement) {
                    appendLog(logElement, `ERROR(${labelPrefix}): ${error}\n`, '>');
                    logElement.scrollTop = logElement.scrollHeight;
                }
                console.error("Error sending app command or receiving response:", error);
                return null;
            } finally {
                const shouldEnable = peripheral.device && peripheral.device.gatt && peripheral.device.gatt.connected;
                if (shouldEnable) controls.forEach(el => el.disabled = false);
            }
        }

        function getWifiCommandOptions() {
            if (!globalThis.__wifiCommandOptions) {
                globalThis.__wifiCommandOptions = {
                    containerSelector: '#wifiCommandsSection',
                    logElementId: 'wifiCmdRspLog',
                    labelPrefix: 'WIFI',
                    responseTimeout: 2000,  // 增加到2秒，避免过早超时
                    maxWait: 15000          // 增加到15秒，给更多时间处理
                };
            }
            return globalThis.__wifiCommandOptions;
        }

        function getNtnCommandOptions() {
            if (!globalThis.__ntnCommandOptions) {
                globalThis.__ntnCommandOptions = {
                    containerSelector: '#ntnSmsSection',
                    logElementId: 'ntnCmdRspLog',
                    labelPrefix: 'NTN',
                    responseTimeout: 2000,
                    maxWait: 15000
                };
            }
            return globalThis.__ntnCommandOptions;
        }

        function getEsimCommandOptions() {
            if (!globalThis.__esimCommandOptions) {
                globalThis.__esimCommandOptions = {
                    containerSelector: '#esimDownloadSection',
                    logElementId: 'esimCmdRspLog',
                    labelPrefix: 'ESIM',
                    responseTimeout: 800,
                    maxWait: 30000
                };
            }
            return globalThis.__esimCommandOptions;
        }

        const ntnStateMap = {
            0: 'IDLE',
            1: 'POWERING_ON',
            2: 'REGISTERING',
            3: 'REGISTERED',
            4: 'SENDING',
            5: 'WAITING_RSP',
            6: 'DONE',
            7: 'FAILED',
            8: 'QUOTA_BLOCKED',
            9: 'BUSY'
        };

        const ntnStateTextMap = {
            0: '空闲',
            1: '上电/唤醒中',
            2: '注网中',
            3: '已注网，可发送',
            4: '发送中',
            5: '等待下行/响应',
            6: '会话完成',
            7: '会话失败',
            8: '配额/频率限制',
            9: '会话忙'
        };

        const ntnSmsTxStateMap = {
            0: 'ACCEPTED',
            1: 'SENT',
            2: 'FAILED',
            3: 'BUSY',
            4: 'NOT_READY'
        };
        const ntnPendingSmsText = new Map();

        function utf8ByteLength(text) {
            return new TextEncoder().encode(text || '').length;
        }

        function setNtnMessage(message, color = '#4b5563') {
            const el = document.getElementById('ntnMessage');
            if (!el) return;
            el.textContent = message || '';
            el.style.color = color;
        }

        function setTextById(id, text) {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        }

        function formatNtnState(state) {
            const name = ntnStateMap[state] || 'UNKNOWN';
            const text = ntnStateTextMap[state] || '未知状态';
            return `${state} (${name} / ${text})`;
        }

        function renderNtnStatus(data) {
            if (!data || typeof data !== 'object') return;
            if (data.mode !== undefined) setTextById('ntnModeValue', `${data.mode}${data.mode === 5 ? ' (NTN_ONLY)' : ''}`);
            if (data.state !== undefined) setTextById('ntnStateValue', formatNtnState(data.state));
            if (data.ready !== undefined) setTextById('ntnReadyValue', data.ready ? '1 (READY)' : '0 (NOT READY)');
            if (data.err !== undefined) setTextById('ntnErrValue', data.err);
        }

        function formatNtnEnvMode(value) {
            const mode = Number(value);
            if (mode === 0) return '0 (生产环境 IP)';
            if (mode === 1) return '1 (调试环境 IP)';
            if (mode === -1) return '-1 (参数错误)';
            return `${value} (未知)`;
        }

        function renderNtnEnvMode(value) {
            setTextById('ntnEnvValue', formatNtnEnvMode(value));
            const select = document.getElementById('ntnEnvSelect');
            if (select && (Number(value) === 0 || Number(value) === 1)) {
                select.value = String(value);
            }
        }

        function appendNtnEventLog(payload) {
            const log = document.getElementById('ntnEventLog');
            if (!log) return;
            appendLog(log, JSON.stringify(payload), '>');
            log.scrollTop = log.scrollHeight;
        }

        function normalizeNtnSmsText(text) {
            return String(text || '').replace(/^[\u0000-\u001f\u007f]+/, '');
        }

        function appendNtnConversationMessage({ direction, id, text, meta = '' }) {
            const log = document.getElementById('ntnConversationLog');
            if (!log) return;

            const row = document.createElement('div');
            row.className = direction === 'rx' ? 'flex justify-start' : 'flex justify-end';

            const bubble = document.createElement('div');
            bubble.className = direction === 'rx'
                ? 'max-w-[85%] bg-white border border-gray-200 rounded-md px-3 py-2 shadow-sm'
                : 'max-w-[85%] bg-blue-50 border border-blue-200 rounded-md px-3 py-2 shadow-sm';

            const title = document.createElement('div');
            title.className = 'text-xs text-gray-500 mb-1';
            title.textContent = `${direction === 'rx' ? '收到' : '发送'} #${id ?? 0}${meta ? ` · ${meta}` : ''}`;

            const content = document.createElement('div');
            content.className = 'text-gray-900 whitespace-pre-wrap break-words';
            content.textContent = normalizeNtnSmsText(text);

            bubble.appendChild(title);
            bubble.appendChild(content);
            row.appendChild(bubble);
            log.appendChild(row);
            log.scrollTop = log.scrollHeight;
        }

        function handleNtnEvent(eventData) {
            if (!eventData || typeof eventData !== 'object') return;
            appendNtnEventLog(eventData);

            if (eventData.e === 'ntn_state') {
                renderNtnStatus(eventData);
                const ready = eventData.ready ? 'ready' : 'not ready';
                const state = formatNtnState(eventData.state);
                setNtnMessage(`NTN ${state}, ${ready}, err=${eventData.err ?? 0}`, eventData.ready ? '#16a34a' : '#2563eb');
                return;
            }

            if (eventData.e === 'ntn_sms_tx') {
                const state = ntnSmsTxStateMap[eventData.state] || 'UNKNOWN';
                const ok = eventData.state === 1 && (eventData.err === undefined || eventData.err === 0);
                setNtnMessage(`短信 #${eventData.id} 发送状态: ${state}, err=${eventData.err ?? 0}`, ok ? '#16a34a' : '#dc2626');
                if (ok && ntnPendingSmsText.has(eventData.id)) {
                    appendNtnConversationMessage({
                        direction: 'tx',
                        id: eventData.id,
                        text: ntnPendingSmsText.get(eventData.id),
                        meta: state
                    });
                    ntnPendingSmsText.delete(eventData.id);
                }
                return;
            }

            if (eventData.e === 'ntn_sms_rx') {
                setNtnMessage(`收到下行短信 #${eventData.id || 0}, ${eventData.len ?? utf8ByteLength(eventData.text || '')} bytes`, '#16a34a');
                appendNtnConversationMessage({
                    direction: 'rx',
                    id: eventData.id || 0,
                    text: eventData.text || '',
                    meta: `${eventData.len ?? utf8ByteLength(eventData.text || '')} bytes`
                });
            }
        }

        function updateNtnSmsByteCount() {
            const input = document.getElementById('ntnSmsText');
            const counter = document.getElementById('ntnSmsByteCount');
            if (!input || !counter) return;
            const bytes = utf8ByteLength(input.value);
            counter.textContent = bytes;
            counter.className = bytes > 140 ? 'text-red-600 font-semibold' : '';
        }

        function parseFirstCommandResponse(raw, commandName) {
            const payloads = parseMultipleJsonResponses(raw || '');
            return payloads.find(item => item && item.c === commandName) || null;
        }

        async function sendNtnCommand(command, commandName) {
            const rsp = await sendAppCommandViaBle(
                JSON.stringify(command),
                { ...getNtnCommandOptions(), expectedCommand: commandName }
            );
            const payload = parseFirstCommandResponse(rsp, commandName);
            if (payload && payload.r && commandName === 'ntn.status') {
                renderNtnStatus(payload.r);
                setNtnMessage('NTN 状态已更新。', payload.r.ready ? '#16a34a' : '#2563eb');
            } else if (payload && payload.e !== undefined) {
                setNtnMessage(`${commandName} 失败: ${payload.m || payload.e}`, '#dc2626');
            }
            return payload;
        }

        async function handleNtnEnterOnlyMode() {
            setNtnMessage('正在进入仅卫星通讯模式...', '#2563eb');
            const payload = await sendNtnCommand({ c: 'pm.mode', p: { m: 5 } }, 'pm.mode');
            if (payload && payload.e === undefined) setNtnMessage('已发送进入仅卫星通讯模式命令，等待 NTN 状态事件或查询结果。', '#16a34a');
        }

        async function handleNtnExitOnlyMode() {
            setNtnMessage('正在切回默认 PM 模式...', '#2563eb');
            const payload = await sendNtnCommand({ c: 'pm.mode', p: { m: 1 } }, 'pm.mode');
            if (payload && payload.e === undefined) setNtnMessage('已发送退出仅卫星通讯模式命令。', '#16a34a');
        }

        async function handleNtnStatus() {
            setNtnMessage('正在查询 NTN 状态...', '#2563eb');
            await sendNtnCommand({ c: 'ntn.status' }, 'ntn.status');
        }

        async function handleNtnEnvQuery() {
            setNtnMessage('正在查询卫星调试环境模式...', '#2563eb');
            const payload = await sendNtnCommand({ c: 'env' }, 'env');
            if (!payload) return;

            if (payload.r === 0 || payload.r === 1) {
                renderNtnEnvMode(payload.r);
                setNtnMessage(`卫星调试环境模式：${formatNtnEnvMode(payload.r)}`, '#16a34a');
            } else if (payload.r === -1) {
                renderNtnEnvMode(payload.r);
                setNtnMessage('查询卫星调试环境模式失败：参数错误', '#dc2626');
            }
        }

        async function handleNtnEnvSet() {
            const select = document.getElementById('ntnEnvSelect');
            const mode = Number(select?.value);
            if (mode !== 0 && mode !== 1) {
                setNtnMessage('卫星调试环境模式参数错误，只能选择 0 或 1。', '#dc2626');
                return;
            }

            setNtnMessage(`正在设置卫星调试环境模式为：${formatNtnEnvMode(mode)}...`, '#2563eb');
            const payload = await sendNtnCommand({ c: 'env', p: mode }, 'env');
            if (!payload) return;

            if (payload.r === 0) {
                renderNtnEnvMode(mode);
                setNtnMessage(`卫星调试环境模式设置成功：${formatNtnEnvMode(mode)}`, '#16a34a');
            } else if (payload.r === -1) {
                renderNtnEnvMode(payload.r);
                setNtnMessage('设置卫星调试环境模式失败：参数错误', '#dc2626');
            }
        }

        async function handleNtnSmsSend() {
            const idInput = document.getElementById('ntnSmsId');
            const textInput = document.getElementById('ntnSmsText');
            const id = Number(idInput.value);
            const text = textInput.value || '';
            const bytes = utf8ByteLength(text);

            if (!Number.isInteger(id) || id < 0 || id > 65535) {
                setNtnMessage('消息 ID 必须是 0 ~ 65535 的整数。', '#dc2626');
                idInput.focus();
                return;
            }
            if (bytes < 1 || bytes > 140) {
                setNtnMessage('短信文本长度必须是 1 ~ 140 字节。', '#dc2626');
                textInput.focus();
                updateNtnSmsByteCount();
                return;
            }

            setNtnMessage(`正在发送短信 #${id}...`, '#2563eb');
            const payload = await sendNtnCommand(
                { c: 'ntn.sms', p: { id, payload: encodeBase64FromBytes(text) } },
                'ntn.sms'
            );
            if (payload && payload.r && payload.r.accepted === 1) {
                ntnPendingSmsText.set(payload.r.id, text);
                setNtnMessage(`短信 #${payload.r.id} 已被设备接受，等待 ntn_sms_tx。`, '#16a34a');
            }
        }

        const ntnSmsTextInput = document.getElementById('ntnSmsText');
        if (ntnSmsTextInput) {
            ntnSmsTextInput.addEventListener('input', updateNtnSmsByteCount);
            updateNtnSmsByteCount();
        }

        function safeJsonParse(str) {
            if (typeof str !== 'string') return null;
            try {
                return JSON.parse(str.trim());
            } catch (error) {
                console.warn('无法解析 JSON 响应:', str, error);
                return null;
            }
        }

        function parseMultipleJsonResponses(str) {
            return parseMultipleJsonResponsesWithRemainder(str).results;
        }

        function parseMultipleJsonResponsesWithRemainder(str) {
            if (typeof str !== 'string') return { results: [], remainder: '' };

            const results = [];
            let currentPos = 0;

            while (currentPos < str.length) {
                // 跳过空白字符
                while (currentPos < str.length && /\s/.test(str[currentPos])) {
                    currentPos++;
                }

                if (currentPos >= str.length) break;

                // 寻找JSON对象的开始
                if (str[currentPos] === '{') {
                    let braceCount = 0;
                    let inString = false;
                    let escaped = false;
                    let jsonStart = currentPos;
                    let complete = false;

                    // 找到完整的JSON对象
                    while (currentPos < str.length) {
                        const char = str[currentPos];
                        if (inString) {
                            if (escaped) {
                                escaped = false;
                            } else if (char === '\\') {
                                escaped = true;
                            } else if (char === '"') {
                                inString = false;
                            }
                        } else if (char === '"') {
                            inString = true;
                        } else if (char === '{') {
                            braceCount++;
                        } else if (char === '}') {
                            braceCount--;
                            if (braceCount === 0) {
                                // 找到完整的JSON对象
                                const jsonStr = str.substring(jsonStart, currentPos + 1);
                                const parsed = safeJsonParse(jsonStr);
                                if (parsed) {
                                    results.push(parsed);
                                }
                                currentPos++;
                                complete = true;
                                break;
                            }
                        }
                        currentPos++;
                    }
                    if (!complete) {
                        return { results, remainder: str.substring(jsonStart) };
                    }
                } else {
                    currentPos++;
                }
            }

            return { results, remainder: '' };
        }

        function parseBufferedJsonResponses(text, source = 'APP') {
            const key = source || 'APP';
            const previous = appJsonFragmentBuffers.get(key);
            const hadPrevious = Boolean(previous && previous.text);
            const combined = `${previous?.text || ''}${text || ''}`;
            const { results, remainder } = parseMultipleJsonResponsesWithRemainder(combined);

            if (remainder) {
                const bytes = utf8ByteLength(remainder);
                if (bytes > APP_JSON_FRAGMENT_BUFFER_MAX_BYTES) {
                    appJsonFragmentBuffers.delete(key);
                    appendAppDebugLog(`RAW JSON fragment dropped source=${key} bytes=${bytes} reason=overflow`);
                } else {
                    appJsonFragmentBuffers.set(key, {
                        text: remainder,
                        updatedAt: Date.now()
                    });
                    appendAppDebugLog(`RAW JSON fragment buffered source=${key} bytes=${bytes}`);
                }
            } else if (hadPrevious) {
                appJsonFragmentBuffers.delete(key);
            }

            if (hadPrevious && results.length > 0) {
                appendAppDebugLog(`RAW JSON reassembled source=${key} count=${results.length} remainder=${remainder ? utf8ByteLength(remainder) : 0}`);
            }

            return results;
        }

        let esimEventWaiters = [];
        const ESIM_DEFAULT_CHUNK_LIMIT = 512;
        const ESIM_ACTIVATION_CODE_MAX_BYTES = 256;
        const ESIM_CONFIRMATION_CODE_MAX_BYTES = 40;
        const ESIM_RELAY_CLIENT_ID = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        const ESIM_RELAY_OWNER_KEY = 'ble_web_tool.esim.relay.owner';
        const ESIM_RELAY_REQUEST_PREFIX = 'ble_web_tool.esim.relay.request.';
        const ESIM_RELAY_LOCK_TTL_MS = 10 * 60 * 1000;
        const esimDownloadState = {
            chunkLimit: ESIM_DEFAULT_CHUNK_LIMIT,
            requestId: null,
            total: 0,
            lastAckOffset: 0,
            smdpAddress: '',
            relaying: false,
            relayQueue: Promise.resolve(),
            abortController: null,
            handledHttpsRequests: new Set()
        };

        function setEsimMessage(message, color = '#4b5563') {
            const el = document.getElementById('esimMessage');
            if (!el) return;
            el.textContent = message || '';
            el.style.color = color;
        }

        function appendEsimTextLogLine(log, message, direction = '>') {
            const value = String(message ?? '');
            const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const text = /[\r\n]$/.test(value) ? normalized : `${normalized}\n`;
            text.split('\n').forEach((segment, index, segments) => {
                if (index === segments.length - 1 && segment === '') return;
                log.appendChild(document.createTextNode(`${timestamp()}${direction} ${segment}\n`));
            });
        }

        function appendEsimRawBodyDetails(log, label, body) {
            const details = document.createElement('details');
            details.className = 'esim-raw-body-details';

            const summary = document.createElement('summary');
            summary.textContent = label;
            details.appendChild(summary);

            const pre = document.createElement('pre');
            pre.className = 'esim-raw-body';
            pre.textContent = String(body ?? '');
            details.appendChild(pre);

            log.appendChild(details);
            log.appendChild(document.createTextNode('\n'));
        }

        function appendEsimLog(logId, message, direction = '>', rawBody) {
            const log = document.getElementById(logId);
            if (!log) return;
            appendEsimTextLogLine(log, message, direction);
            if (rawBody && rawBody.label) {
                appendEsimRawBodyDetails(log, rawBody.label, rawBody.body);
            }
            log.scrollTop = log.scrollHeight;
        }

        function appendEsimEventLog(payload) {
            appendEsimLog('esimEventLog', JSON.stringify(payload), '>');
        }

        function makeEsimFlowStopError(message) {
            const error = new Error(message);
            error.esimFlowStop = true;
            return error;
        }

        function hashText(text) {
            let hash = 2166136261;
            for (let i = 0; i < text.length; i += 1) {
                hash ^= text.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            return (hash >>> 0).toString(36);
        }

        function readJsonStorage(key) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            } catch (_) {
                return null;
            }
        }

        function writeJsonStorage(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (_) {
                return false;
            }
        }

        function claimEsimRelayOwnership(reason = 'relay', force = false) {
            const now = Date.now();
            const current = readJsonStorage(ESIM_RELAY_OWNER_KEY);
            const ownedByOther = current
                && current.owner
                && current.owner !== ESIM_RELAY_CLIENT_ID
                && now - Number(current.updatedAt || 0) < ESIM_RELAY_LOCK_TTL_MS;
            if (ownedByOther && !force) return false;

            const next = {
                owner: ESIM_RELAY_CLIENT_ID,
                updatedAt: now,
                reason
            };
            if (!writeJsonStorage(ESIM_RELAY_OWNER_KEY, next)) return true;

            const confirmed = readJsonStorage(ESIM_RELAY_OWNER_KEY);
            return !confirmed || confirmed.owner === ESIM_RELAY_CLIENT_ID;
        }

        function refreshEsimRelayOwnership(reason = 'relay') {
            claimEsimRelayOwnership(reason, true);
        }

        function releaseEsimRelayOwnership() {
            const current = readJsonStorage(ESIM_RELAY_OWNER_KEY);
            if (!current || current.owner !== ESIM_RELAY_CLIENT_ID) return;
            try {
                localStorage.removeItem(ESIM_RELAY_OWNER_KEY);
            } catch (_) {
                // Ignore storage cleanup failures.
            }
        }

        function clearEsimRelayRequestLocks() {
            try {
                for (let i = localStorage.length - 1; i >= 0; i -= 1) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith(ESIM_RELAY_REQUEST_PREFIX)) {
                        localStorage.removeItem(key);
                    }
                }
            } catch (_) {
                // Ignore storage cleanup failures.
            }
        }

        function makeEsimRelayRequestKey(request) {
            const body = request?.body === undefined || request?.body === null ? '' : String(request.body);
            const url = String(request?.url || '');
            const smdp = String(request?.smdpAddress || request?.smdp || esimDownloadState.smdpAddress || '');
            const id = String(request?.id ?? '');
            const signature = JSON.stringify({ id, url, smdp, body });
            return `${id || '-'}-${hashText(signature)}`;
        }

        function claimEsimRelayRequest(key, request) {
            const now = Date.now();
            const storageKey = `${ESIM_RELAY_REQUEST_PREFIX}${key}`;
            const current = readJsonStorage(storageKey);
            const ownedByOther = current
                && current.owner
                && current.owner !== ESIM_RELAY_CLIENT_ID
                && now - Number(current.updatedAt || 0) < ESIM_RELAY_LOCK_TTL_MS;
            if (ownedByOther) return false;

            const next = {
                owner: ESIM_RELAY_CLIENT_ID,
                updatedAt: now,
                id: request?.id ?? null,
                url: request?.url || '',
                bodyBytes: utf8ByteLength(request?.body || '')
            };
            if (!writeJsonStorage(storageKey, next)) return true;

            const confirmed = readJsonStorage(storageKey);
            return !confirmed || confirmed.owner === ESIM_RELAY_CLIENT_ID;
        }

        function getEsimPayloadName(payload) {
            if (!payload || typeof payload !== 'object') return '';
            if (typeof payload.c === 'string') return payload.c;
            if (typeof payload.e === 'string') return payload.e;
            return '';
        }

        function getEsimPayloadCode(payload) {
            if (!payload || typeof payload !== 'object') return undefined;
            if (payload.c && payload.e !== undefined && typeof payload.e !== 'string') {
                const code = Number(payload.e);
                return Number.isFinite(code) ? code : payload.e;
            }
            const result = payload.r;
            if (result && typeof result === 'object' && result.code !== undefined) {
                const code = Number(result.code);
                return Number.isFinite(code) ? code : result.code;
            }
            return undefined;
        }

        // eSIM 结果码（GSMA 0x85000xxx 系列）中文释义表。
        // 键统一用小写十六进制字符串（去掉 0x 前缀，与厂商提供的对照表一致）。
        const ESIM_RESULT_CODE_DESCRIPTIONS = {
            '0': 'OK',
            '85000001': '存储错误',
            '85000002': '无效值错误',
            '85000003': '激活码错误',
            '85000004': '操作超时',
            '85000005': '通用错误',
            '85000006': '缓冲区溢出错误',
            '85000007': '操作错误',
            '85000008': '消息发送错误',
            '85000009': 'APDU 发送错误',
            '8500000a': 'APDU 状态错误',
            '8500000b': 'APDU 解析错误',
            '8500000c': 'TLV 解析错误',
            '8500000d': 'JSON 解析错误',
            '8500000e': '文件系统操作错误',
            '8500000f': 'HTTPS 操作错误',
            '85000010': 'HTTPS 繁忙错误',
            '85000011': '系统繁忙',
            '85000012': '获取 eUICC 信息 1 错误',
            '85000013': 'HTTPS 消息发送错误',
            '85000014': 'HTTPS 响应错误',
            '85000015': 'HTTPS 头错误',
            '85000016': 'SMDP 返回错误',
            '85000017': '数据等待超时',
            '85000101': '配置文件启用失败：未发现 ICCID 或 AID',
            '85000102': '配置文件启用失败：配置文件已启用',
            '85000103': '配置文件启用失败：策略不允许',
            '85000104': '配置文件启用失败：重新启用配置文件时出错',
            '85000105': '配置文件启用失败：卡应用繁忙',
            '8500017f': '配置文件启用失败：未定义错误',
            '85000201': '配置文件禁用失败：未发现 ICCID 或 AID',
            '85000202': '配置文件禁用失败：配置文件已禁用',
            '85000203': '配置文件禁用失败：策略不允许',
            '85000204': '配置文件禁用失败：卡应用繁忙',
            '8500027f': '配置文件禁用失败：未定义错误',
            '85000301': '配置文件删除失败：未发现 ICCID 或 AID',
            '85000302': '配置文件删除失败：配置文件已启用',
            '85000303': '配置文件删除失败：策略不允许',
            '8500037f': '配置文件删除失败：未定义错误',
            '85000401': '配置文件列举失败：输入值不正确',
            '8500047f': '配置文件列举失败：未定义错误',
            '85000501': '别名定义错误：ICCID 未找到',
            '8500057f': '别名定义错误：未定义错误',
            '85000601': '通知错误：无内容可删除',
            '8500067f': '通知错误：未定义错误',
            '85000701': '认证服务器错误：无效证书',
            '85000702': '认证服务器错误：无效签名',
            '85000703': '认证服务器错误：不支持的曲线',
            '85000704': '认证服务器错误：无会话上下文',
            '85000705': '认证服务器错误：无效 OID',
            '85000706': '认证服务器错误：eUICC Challenge 不匹配',
            '85000707': '认证服务器错误：CIPK 未知',
            '8500077f': '认证服务器错误：未定义错误',
            '85000801': '准备下载错误：无效证书',
            '85000802': '准备下载错误：无效签名',
            '85000803': '准备下载错误：不支持的曲线',
            '85000804': '准备下载错误：无会话上下文',
            '85000805': '准备下载错误：无效事务 ID',
            '8500087f': '准备下载错误：未定义错误',
            '85000901': '安装失败：输入值不正确',
            '85000902': '安装失败：无效签名',
            '85000903': '安装失败：无效事务 ID',
            '85000904': '安装失败：不支持的 CRT 值',
            '85000905': '安装失败：不支持的远程操作类型',
            '85000906': '安装失败：不支持的配置文件类别',
            '85000907': '安装失败：SECP03T 结构错误',
            '85000908': '安装失败：SECP03T 安全错误',
            '85000909': '安装失败：ICCID 已存在于 eSIM',
            '8500090a': '安装失败：配置文件内存不足',
            '8500090b': '安装失败：操作中断',
            '8500090c': '安装失败：PE 处理错误',
            '8500090d': '安装失败：数据不匹配',
            '8500090e': '测试配置文件安装失败：无效的 NAA 密钥',
            '8500090f': '安装失败：不允许的 PPR',
            '8500097f': '安装失败：未定义错误',
            '85000a02': '备用配置文件错误：配置文件已启用',
            '85000a05': '备用配置文件错误：卡应用忙碌',
            '85000a06': '备用配置文件错误：不可用',
            '85000a07': '备用配置文件错误：命令错误',
            '85000a7f': '备用配置文件错误：未定义错误'
        };

        // 返回结果码对应的中文释义；未知则返回空字符串。
        // 兼容两种常见传输约定：数字（如设备直接以十进制 JSON 发送的 85000704）
        // 与字符串（如 "0x85000704"、"8500090E"）。
        function describeEsimResultCode(code) {
            if (code === undefined || code === null) return '';
            if (typeof code === 'string') {
                const key = code.trim().toLowerCase().replace(/^0x/, '');
                return ESIM_RESULT_CODE_DESCRIPTIONS[key] || '';
            }
            const numeric = Number(code);
            if (!Number.isFinite(numeric)) return '';
            // 优先按设备"原样字符串"匹配（如十进制 85000704），再用十六进制兜底
            // （如设备已转成等价十进制 2231373524 的情况）。
            const asDecimal = String(numeric);
            if (ESIM_RESULT_CODE_DESCRIPTIONS[asDecimal]) return ESIM_RESULT_CODE_DESCRIPTIONS[asDecimal];
            const asHex = numeric.toString(16);
            return ESIM_RESULT_CODE_DESCRIPTIONS[asHex] || '';
        }

        // 返回带中文释义的结果码展示串，如 "85000704 (认证服务器错误：无会话上下文)"；
        // 未知码仅返回码本身。
        function formatEsimResultCode(code) {
            if (code === undefined || code === null || code === '') return '-';
            const description = describeEsimResultCode(code);
            return description ? `${code} (${description})` : String(code);
        }

        function getEsimAckOffset(payload) {
            const result = payload && payload.r;
            if (result && typeof result === 'object') {
                return Number(result.offset);
            }
            return Number(result);
        }

        function removeEsimEventWaiter(waiter) {
            if (!waiter) return;
            if (waiter.timer) clearTimeout(waiter.timer);
            esimEventWaiters = esimEventWaiters.filter(item => item !== waiter);
        }

        function rejectEsimEventWaiters(error, eventName = '') {
            const waiters = [...esimEventWaiters];
            waiters.forEach(waiter => {
                if (eventName && waiter.eventName !== eventName) return;
                removeEsimEventWaiter(waiter);
                waiter.reject(error);
            });
        }

        function waitForEsimEvent(eventName, predicate, timeoutMs = 30000) {
            let waiter = null;
            const promise = new Promise((resolve, reject) => {
                waiter = {
                    eventName,
                    predicate: typeof predicate === 'function' ? predicate : () => true,
                    resolve,
                    reject,
                    timer: setTimeout(() => {
                        removeEsimEventWaiter(waiter);
                        reject(new Error(`等待 ${eventName} 事件超时`));
                    }, timeoutMs)
                };
                esimEventWaiters.push(waiter);
            });
            return {
                promise,
                cancel() {
                    removeEsimEventWaiter(waiter);
                }
            };
        }

        function notifyEsimEventWaiters(payload) {
            const eventName = getEsimPayloadName(payload);
            if (!eventName || esimEventWaiters.length === 0) return;

            const waiters = [...esimEventWaiters];
            waiters.forEach(waiter => {
                if (waiter.eventName !== eventName) return;
                let matched = false;
                try {
                    matched = waiter.predicate(payload);
                } catch (error) {
                    removeEsimEventWaiter(waiter);
                    waiter.reject(error);
                    return;
                }
                if (!matched) return;
                removeEsimEventWaiter(waiter);
                waiter.resolve(payload);
            });
        }

        function dispatchEsimPayloads(responses, source = 'APP') {
            responses.forEach(response => {
                const eventName = getEsimPayloadName(response);
                if (eventName.startsWith('esim.')) {
                    console.info(`[eSIM] ${source} event`, response);
                    handleEsimEvent(response);
                    notifyEsimEventWaiters(response);
                }
            });
            return responses;
        }

        function dispatchEsimPayloadsFromText(text, source = 'APP') {
            return dispatchEsimPayloads(parseMultipleJsonResponses(text), source);
        }

        function setEsimMetric(id, value) {
            setTextById(id, value === undefined || value === null || value === '' ? '-' : String(value));
        }

        function updateEsimActivationByteCount() {
            const input = document.getElementById('esimActivationCode');
            const counter = document.getElementById('esimActivationByteCount');
            if (!input || !counter) return;
            const bytes = utf8ByteLength(input.value);
            counter.textContent = bytes;
            counter.className = bytes > ESIM_ACTIVATION_CODE_MAX_BYTES ? 'text-red-600 font-semibold' : '';
        }

        function parseSmdpAddressFromActivationCode(ac) {
            const parts = String(ac || '').trim().split('$');
            if (parts.length >= 3 && /^LPA:/i.test(parts[0])) {
                return (parts[1] || '').trim();
            }
            return '';
        }

        function resetEsimProgress() {
            esimDownloadState.requestId = null;
            esimDownloadState.total = 0;
            esimDownloadState.lastAckOffset = 0;
            esimDownloadState.smdpAddress = '';
            esimDownloadState.handledHttpsRequests.clear();
            setEsimMetric('esimOffsetValue', '0/0');
            setEsimMetric('esimResultValue', '-');
        }

        function renderEsimResult(result) {
            const code = result && typeof result === 'object' ? result.code : result;
            setEsimMetric('esimResultValue', code !== undefined && code !== null ? formatEsimResultCode(code) : '-');
        }

        // 解析 +QESIM: "list" 响应文本为结构化 profile 数组。
        // 响应格式（Quectel）：
        //   +QESIM: "list",0
        //   "<iccid>",<state>,<iconType>,<profileClass>,"<profileName>","<providerName>"
        // 其中 <state>: 0=禁用, 1=启用。
        function parseEsimProfiles(rawText) {
            if (typeof rawText !== 'string') return [];
            const profiles = [];
            const lines = rawText.split(/\r?\n/);
            const fieldRegex = /\s*"((?:[^"\\]|\\.)*)"\s*|\s*([^,]+)/g;
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed === '' || trimmed.startsWith('+QESIM:') || trimmed.startsWith('OK')) continue;

                const fields = [];
                fieldRegex.lastIndex = 0;
                let match;
                while ((match = fieldRegex.exec(trimmed)) !== null) {
                    if (match[1] !== undefined) {
                        fields.push(match[1].replace(/\\"/g, '"'));
                    } else if (match[2] !== undefined) {
                        fields.push(match[2].trim());
                    }
                    if (match.index + match[0].length >= trimmed.length) break;
                }
                if (fields.length === 0) continue;

                const iccid = String(fields[0] || '');
                if (!iccid) continue;
                const state = Number(fields[1]);
                const enabled = state === 1;
                const name = fields[4] !== undefined ? String(fields[4]) : '';
                const provider = fields[5] !== undefined ? String(fields[5]) : '';
                profiles.push({ iccid, state: Number.isFinite(state) ? state : null, enabled, name, provider });
            }
            return profiles;
        }

        function escapeEsimIccid(iccid) {
            return String(iccid).replace(/[^0-9A-Za-z]/g, '');
        }

        function refreshEsimProfileActionButtons() {
            // 连接状态变化由 .cmd 统一控制，这里仅根据行内状态刷新启用按钮。
            const rows = document.querySelectorAll('#esimListResult .esim-profile-row');
            rows.forEach(row => {
                const enabled = row.dataset.enabled === '1';
                const enableBtn = row.querySelector('.esim-row-enable');
                if (enableBtn) {
                    enableBtn.disabled = enabled || !isDeviceConnected();
                }
            });
        }

        function renderEsimList(payload) {
            const container = document.getElementById('esimListResult');
            if (!container) return;
            const value = payload && payload.r !== undefined ? payload.r : payload;
            const rawList = value && typeof value === 'object' && typeof value.list === 'string'
                ? value.list
                : (typeof value === 'string' ? value : '');

            const profiles = parseEsimProfiles(rawList);
            if (profiles.length === 0) {
                container.textContent = '（无 profile，点击「刷新列表」重新查询）';
                return;
            }

            container.textContent = '';
            profiles.forEach(profile => {
                const row = document.createElement('div');
                row.className = 'esim-profile-row' + (profile.enabled ? ' is-enabled' : '');
                row.dataset.iccid = profile.iccid;
                row.dataset.enabled = profile.enabled ? '1' : '0';

                const main = document.createElement('div');
                main.className = 'esim-profile-main';

                const badge = document.createElement('span');
                badge.className = 'esim-profile-state ' + (profile.enabled ? 'is-on' : 'is-off');
                badge.textContent = profile.enabled ? '启用中' : '已禁用';

                const nameWrap = document.createElement('div');
                nameWrap.className = 'esim-profile-name';
                const nameText = profile.name || profile.provider || '(未命名)';
                nameWrap.textContent = nameText;
                if (profile.provider && profile.provider !== nameText) {
                    nameWrap.textContent = `${nameText} · ${profile.provider}`;
                }

                const iccidEl = document.createElement('span');
                iccidEl.className = 'esim-profile-iccid';
                iccidEl.textContent = profile.iccid;

                main.appendChild(badge);
                main.appendChild(nameWrap);
                main.appendChild(iccidEl);
                row.appendChild(main);

                const actions = document.createElement('div');
                actions.className = 'esim-profile-actions';

                const enableBtn = document.createElement('button');
                enableBtn.type = 'button';
                enableBtn.className = 'cmd cmd-button';
                enableBtn.textContent = '启用';
                enableBtn.disabled = profile.enabled || !isDeviceConnected();
                enableBtn.addEventListener('click', () => {
                    handleEsimEnable(profile.iccid);
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'cmd cmd-button danger';
                deleteBtn.textContent = '删除';
                deleteBtn.disabled = !isDeviceConnected();
                deleteBtn.addEventListener('click', () => {
                    handleEsimDelete(profile.iccid);
                });

                actions.appendChild(enableBtn);
                actions.appendChild(deleteBtn);
                row.appendChild(actions);

                container.appendChild(row);
            });
        }

        function esimCommandErrorText(payload, commandName) {
            if (!payload) return `${commandName} 未收到响应`;
            if (payload.c && payload.e !== undefined) {
                const codeText = formatEsimResultCode(payload.e);
                return `${commandName} 失败: ${payload.m || codeText}`;
            }
            const code = getEsimPayloadCode(payload);
            if (code !== undefined && code !== 0) return `${commandName} 失败: ${payload.m || formatEsimResultCode(code)}`;
            return '';
        }

        async function sendEsimCommand(command, commandName, options = {}) {
            const rsp = await sendAppCommandViaBle(
                JSON.stringify(command),
                { ...getEsimCommandOptions(), expectedCommand: commandName, ...options }
            );
            if (!rsp) return null;
            return parseFirstCommandResponse(rsp, commandName);
        }

        async function sendEsimCommandNoResponse(command) {
            const jsonString = JSON.stringify(command);
            const logElement = document.getElementById('esimCmdRspLog');

            if (!isDeviceConnected()) {
                const message = '设备未连接';
                setConnectionStatus("设备未连接 (Device not connected)", 'red');
                if (logElement) {
                    appendLog(logElement, `ERROR(ESIM): ${message}\n`, '>');
                    logElement.scrollTop = logElement.scrollHeight;
                }
                throw new Error(message);
            }

            if (logElement) {
                appendLog(logElement, `SENT(ESIM): ${jsonString}\n`, '<');
                logElement.scrollTop = logElement.scrollHeight;
            }

            await peripheral.sendCmd(uuidSvcSatellai, uuidCharApp, jsonString);
        }

        async function sendEsimDataChunk(command, id, offset, timeoutMs = 30000) {
            const waiter = waitForEsimEvent('esim.data', payload => {
                if (payload.c === 'esim.data' && payload.e !== undefined) return true;
                if (payload.e !== 'esim.data') return false;

                const result = payload.r;
                if (result && typeof result === 'object') {
                    if (result.id !== undefined && Number(result.id) !== id) return false;
                    const code = getEsimPayloadCode(payload);
                    if (code !== undefined && code !== 0) return true;
                    return Number.isFinite(Number(result.offset)) && Number(result.offset) > offset;
                }

                return Number.isFinite(Number(result)) && Number(result) > offset;
            }, timeoutMs);

            try {
                await sendEsimCommandNoResponse(command);
                return await waiter.promise;
            } catch (error) {
                waiter.cancel();
                throw error;
            }
        }

        async function handleEsimStart() {
            const acInput = document.getElementById('esimActivationCode');
            const ccInput = document.getElementById('esimConfirmationCode');
            const ac = (acInput?.value || '').trim();
            const cc = (ccInput?.value || '').trim();
            const acBytes = utf8ByteLength(ac);
            const ccBytes = utf8ByteLength(cc);

            if (!ac) {
                setEsimMessage('请输入 eSIM 激活码 AC。', '#dc2626');
                acInput && acInput.focus();
                return;
            }
            if (acBytes > ESIM_ACTIVATION_CODE_MAX_BYTES) {
                setEsimMessage(`AC 不能超过 ${ESIM_ACTIVATION_CODE_MAX_BYTES} 字节。`, '#dc2626');
                acInput && acInput.focus();
                updateEsimActivationByteCount();
                return;
            }
            if (ccBytes > ESIM_CONFIRMATION_CODE_MAX_BYTES) {
                setEsimMessage(`CC 不能超过 ${ESIM_CONFIRMATION_CODE_MAX_BYTES} 字节。`, '#dc2626');
                ccInput && ccInput.focus();
                return;
            }
            const smdpAddress = parseSmdpAddressFromActivationCode(ac);
            if (!smdpAddress) {
                setEsimMessage('无法从 AC 解析 SMDP 地址，请检查 LPA:1$地址$... 格式。', '#dc2626');
                acInput && acInput.focus();
                return;
            }
            if (!peripheral.transportReady) {
                try {
                    await ensureBleTransportNotifications();
                    appendEsimLog('esimCmdRspLog', 'TRANSPORT CCC retry subscribed: 0000000e-ffff-4fff-8fff-5a7e11a1ffff', '>');
                } catch (error) {
                    const message = `BLE 大包 TRANSPORT CCC 未订阅成功，请重新连接设备后再开始 eSIM 下载: ${error.message || error}`;
                    setEsimMessage(message, '#dc2626');
                    appendEsimLog('esimCmdRspLog', message, '>');
                    return;
                }
            }

            const command = { c: 'esim.start', p: { ac } };
            if (cc) command.p.cc = cc;

            resetEsimProgress();
            clearEsimRelayRequestLocks();
            refreshEsimRelayOwnership('start');
            esimDownloadState.smdpAddress = smdpAddress;
            setEsimMetric('esimStatusValue', 'starting');
            setEsimMetric('esimChunkLimitValue', '-');
            setEsimMessage(`正在启动 eSIM 下载会话，SMDP=${smdpAddress}...`, '#2563eb');

            const payload = await sendEsimCommand(command, 'esim.start');
            const errorText = esimCommandErrorText(payload, 'esim.start');
            if (errorText) {
                setEsimMessage(errorText, '#dc2626');
                setEsimMetric('esimStatusValue', 'start failed');
                return;
            }

            if (Number.isFinite(Number(payload.r)) && Number(payload.r) > 0) {
                esimDownloadState.chunkLimit = Number(payload.r);
                setEsimMetric('esimChunkLimitValue', `${esimDownloadState.chunkLimit} bytes`);
            }
            setEsimMessage('eSIM 下载会话已受理，等待 HTTPS 中转请求。', '#16a34a');
        }

        async function handleEsimCancel() {
            if (esimDownloadState.abortController) {
                esimDownloadState.abortController.abort();
                esimDownloadState.abortController = null;
            }
            rejectEsimEventWaiters(makeEsimFlowStopError('eSIM 会话已取消。'));

            setEsimMessage('正在取消 eSIM 会话...', '#2563eb');
            const payload = await sendEsimCommand({ c: 'esim.cancel' }, 'esim.cancel', { maxWait: 10000 });
            const errorText = esimCommandErrorText(payload, 'esim.cancel');
            if (errorText) {
                setEsimMessage(errorText, '#dc2626');
                return;
            }
            setEsimMetric('esimStatusValue', 'canceling');
            setEsimMessage('取消命令已发送。', '#16a34a');
            releaseEsimRelayOwnership();
        }

        async function handleEsimList() {
            if (!isDeviceConnected()) {
                setEsimMessage('设备未连接，无法查询列表。', '#dc2626');
                return;
            }
            setEsimMessage('正在查询 eSIM profile 列表...', '#2563eb');
            const payload = await sendEsimCommand({ c: 'esim.list' }, 'esim.list', { maxWait: 10000 });
            const errorText = esimCommandErrorText(payload, 'esim.list');
            if (errorText) {
                setEsimMessage(errorText, '#dc2626');
                return;
            }
            setEsimMessage('查询已受理，等待列表事件。', '#16a34a');
        }

        async function handleEsimEnable(iccid) {
            const targetIccid = escapeEsimIccid(iccid);
            if (!targetIccid) {
                setEsimMessage('请提供要启用的 ICCID。', '#dc2626');
                return;
            }

            setEsimMessage(`正在启用 ICCID ${targetIccid}...`, '#2563eb');
            const payload = await sendEsimCommand({ c: 'esim.enable', p: { iccid: targetIccid } }, 'esim.enable', { maxWait: 10000 });
            const errorText = esimCommandErrorText(payload, 'esim.enable');
            if (errorText) {
                setEsimMessage(errorText, '#dc2626');
                return;
            }
            setEsimMessage('启用命令已受理，等待最终事件。', '#16a34a');
        }

        async function handleEsimDelete(iccid) {
            const targetIccid = escapeEsimIccid(iccid);
            if (!targetIccid) {
                setEsimMessage('请提供要删除的 ICCID。', '#dc2626');
                return;
            }

            setEsimMessage(`正在删除 ICCID ${targetIccid}...`, '#dc2626');
            const payload = await sendEsimCommand({ c: 'esim.delete', p: { iccid: targetIccid } }, 'esim.delete', { maxWait: 10000 });
            const errorText = esimCommandErrorText(payload, 'esim.delete');
            if (errorText) {
                setEsimMessage(errorText, '#dc2626');
                return;
            }
            setEsimMessage('删除命令已受理，等待最终事件。', '#16a34a');
        }

        async function handleEsimOnboardEnter() {
            if (!isDeviceConnected()) {
                setEsimMessage('设备未连接，无法进入引导模式。', '#dc2626');
                return;
            }
            setEsimMessage('正在强制进入 eSIM 引导模式...', '#2563eb');
            const payload = await sendEsimCommand({ c: 'esim.onboard_enter' }, 'esim.onboard_enter', { maxWait: 10000 });
            const errorText = esimCommandErrorText(payload, 'esim.onboard_enter');
            if (errorText) {
                setEsimMessage(errorText, '#dc2626');
                return;
            }
            setEsimMessage('已进入引导模式，等待设备引导提醒事件。', '#16a34a');
        }

        async function handleEsimOnboardExit() {
            if (!isDeviceConnected()) {
                setEsimMessage('设备未连接，无法退出引导模式。', '#dc2626');
                return;
            }
            setEsimMessage('正在强制退出 eSIM 引导模式...', '#2563eb');
            const payload = await sendEsimCommand({ c: 'esim.onboard_exit' }, 'esim.onboard_exit', { maxWait: 10000 });
            const errorText = esimCommandErrorText(payload, 'esim.onboard_exit');
            if (errorText) {
                setEsimMessage(errorText, '#dc2626');
                return;
            }
            setEsimMessage('已退出引导模式，设备将恢复正常的注册流程。', '#16a34a');
        }

        function queueEsimHttpsRelay(request) {
            refreshEsimRelayOwnership('https_relay');
            appendEsimLog(
                'esimHttpLog',
                `QUEUE #${request?.id ?? '-'} ${request?.url || '(empty url)'}`,
                '>'
            );
            console.info('[eSIM] queue HTTPS relay', request);
            esimDownloadState.relayQueue = esimDownloadState.relayQueue
                .catch(() => undefined)
                .then(() => relayEsimHttpsRequest(request))
                .catch(async error => {
                    const message = error && error.name === 'AbortError'
                        ? 'eSIM HTTPS 请求已取消。'
                        : `eSIM HTTPS 中转失败: ${error.message || error}`;
                    appendEsimLog('esimHttpLog', message, '>');
                    setEsimMessage(message, '#dc2626');
                    if (error && error.name !== 'AbortError' && !error.esimFlowStop && isDeviceConnected()) {
                        appendEsimLog('esimHttpLog', 'AUTO cancel disabled: 等待设备侧 result 或手动取消。', '>');
                    }
                });
        }

        async function fetchEsimHttpsViaProxy(url, body, smdpAddress, signal) {
            console.info('[eSIM] fetch local HTTPS relay', { url, smdpAddress, bodyBytes: utf8ByteLength(body) });
            const response = await fetch('/api/esim/https', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, body, smdpAddress }),
                signal
            });
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (!response.ok) {
                let message = new TextDecoder().decode(bytes);
                try {
                    const payload = JSON.parse(message);
                    message = payload.error || message;
                } catch (_) {
                    // Keep the raw body.
                }
                throw new Error(message || `HTTP ${response.status}`);
            }
            return {
                bytes,
                rawBody: new TextDecoder().decode(bytes),
                status: response.headers.get('X-Esim-HTTP-Status') || '-',
                contentType: response.headers.get('X-Esim-HTTP-Content-Type') || '-',
                bodyBytes: response.headers.get('X-Esim-HTTP-Body-Bytes') || '-',
                responseBytes: response.headers.get('X-Esim-HTTP-Response-Bytes') || String(bytes.length),
                resolvedUrl: response.headers.get('X-Esim-Resolved-URL') || url,
                durationMs: response.headers.get('X-Esim-HTTP-Duration-Ms') || '-'
            };
        }

        async function relayEsimHttpsRequest(request) {
            const id = Number(request?.id || 0);
            const url = String(request?.url || '').trim();
            const body = request?.body === undefined || request?.body === null ? '' : String(request.body);
            const smdpAddress = String(request?.smdpAddress || request?.smdp || esimDownloadState.smdpAddress || '').trim();
            if (!url) throw new Error('esim.https_req 缺少 url');

            esimDownloadState.relaying = true;
            esimDownloadState.requestId = id;
            esimDownloadState.lastAckOffset = 0;
            setEsimMetric('esimStatusValue', 'https');
            setEsimMetric('esimOffsetValue', '0/0');
            setEsimMessage(`正在请求 eSIM HTTPS #${id || '-'}...`, '#2563eb');
            appendEsimLog(
                'esimHttpLog',
                `REQ #${id || '-'} ${url} smdp=${smdpAddress || '-'} body=${utf8ByteLength(body)} bytes`,
                '<',
                body
                    ? { label: `原始请求 Body (${utf8ByteLength(body)} bytes)`, body }
                    : null
            );

            const controller = new AbortController();
            esimDownloadState.abortController = controller;
            appendEsimLog('esimHttpLog', `FETCH /api/esim/https #${id || '-'}...`, '<');
            const httpResult = await fetchEsimHttpsViaProxy(url, body, smdpAddress, controller.signal);
            esimDownloadState.abortController = null;

            const bytes = httpResult.bytes;
            esimDownloadState.total = bytes.length;
            appendEsimLog(
                'esimHttpLog',
                `RESP #${id || '-'} ${httpResult.resolvedUrl} status=${httpResult.status} time=${httpResult.durationMs}ms type=${httpResult.contentType} body=${httpResult.bodyBytes} bytes full=${httpResult.responseBytes} bytes`,
                '>',
                { label: `完整原始响应 (${bytes.length} bytes)`, body: httpResult.rawBody }
            );

            const beginPayload = await sendEsimCommand(
                { c: 'esim.resp_begin', p: { id, total: bytes.length } },
                'esim.resp_begin',
                { maxWait: 15000 }
            );
            const beginError = esimCommandErrorText(beginPayload, 'esim.resp_begin');
            if (beginError) throw new Error(beginError);

            if (bytes.length === 0) {
                setEsimMetric('esimOffsetValue', '0/0');
                setEsimMessage(`HTTPS #${id || '-'} 空响应体已提交。`, '#16a34a');
                esimDownloadState.relaying = false;
                return;
            }

            let offset = 0;
            const chunkLimit = Math.max(1, Number(esimDownloadState.chunkLimit) || ESIM_DEFAULT_CHUNK_LIMIT);
            setEsimMetric('esimChunkLimitValue', `${chunkLimit} bytes`);
            setEsimMetric('esimOffsetValue', `0/${bytes.length}`);

            while (offset < bytes.length) {
                const end = Math.min(offset + chunkLimit, bytes.length);
                const chunk = bytes.subarray(offset, end);
                const dataPayload = await sendEsimDataChunk(
                    { c: 'esim.data', p: { id, offset, data: encodeBase64FromBytes(chunk) } },
                    id,
                    offset,
                    30000
                );
                const dataError = esimCommandErrorText(dataPayload, 'esim.data');
                if (dataError) throw new Error(dataError);

                const nextOffset = getEsimAckOffset(dataPayload);
                if (!Number.isFinite(nextOffset) || nextOffset <= offset || nextOffset > bytes.length) {
                    throw new Error(`esim.data ack offset 异常: ${JSON.stringify(dataPayload.r)}`);
                }
                offset = nextOffset;
                esimDownloadState.lastAckOffset = offset;
                setEsimMetric('esimOffsetValue', `${offset}/${bytes.length}`);
                setEsimMessage(`HTTPS #${id || '-'} 已回传 ${offset}/${bytes.length} bytes。`, '#2563eb');
            }

            setEsimMessage(`HTTPS #${id || '-'} 响应体回传完成。`, '#16a34a');
            esimDownloadState.relaying = false;
        }

        function handleEsimEvent(eventData) {
            const eventName = getEsimPayloadName(eventData);
            if (!eventName.startsWith('esim.')) return;
            appendEsimEventLog(eventData);

            if (eventName === 'esim.start' && Number.isFinite(Number(eventData.r)) && Number(eventData.r) > 0) {
                esimDownloadState.chunkLimit = Number(eventData.r);
                setEsimMetric('esimChunkLimitValue', `${esimDownloadState.chunkLimit} bytes`);
                return;
            }

            if (typeof eventData.e !== 'string') {
                if (eventName === 'esim.data' && eventData.e !== undefined) {
                    setEsimMessage(`eSIM 数据块失败：${eventData.e}`, '#dc2626');
                }
                return;
            }

            if (eventName === 'esim.status') {
                setEsimMetric('esimStatusValue', eventData.r);
                setEsimMessage(`eSIM 状态：${eventData.r}`, eventData.r === 'downloading' ? '#2563eb' : '#16a34a');
                return;
            }

            if (eventName === 'esim.https_req') {
                const req = eventData.r || {};
                const key = makeEsimRelayRequestKey(req);
                if (esimDownloadState.handledHttpsRequests.has(key)) {
                    appendEsimLog('esimHttpLog', `SKIP duplicate #${req.id ?? '-'} ${req.url || '(empty url)'}`, '>');
                    return;
                }
                if (!claimEsimRelayOwnership('https_req')) {
                    appendEsimLog('esimHttpLog', `SKIP relay in this tab #${req.id ?? '-'}: another page owns eSIM relay`, '>');
                    return;
                }
                if (!claimEsimRelayRequest(key, req)) {
                    appendEsimLog('esimHttpLog', `SKIP duplicate relay #${req.id ?? '-'} ${req.url || '(empty url)'}`, '>');
                    return;
                }
                esimDownloadState.handledHttpsRequests.add(key);
                queueEsimHttpsRelay(eventData.r);
                return;
            }

            if (eventName === 'esim.data') {
                const code = getEsimPayloadCode(eventData);
                if (code !== undefined && code !== 0) {
                    setEsimMessage(`eSIM 数据块失败：${formatEsimResultCode(code)}`, '#dc2626');
                    return;
                }

                const nextOffset = getEsimAckOffset(eventData);
                if (Number.isFinite(nextOffset)) {
                    esimDownloadState.lastAckOffset = nextOffset;
                    setEsimMetric('esimOffsetValue', `${nextOffset}/${esimDownloadState.total || '?'}`);
                }
                return;
            }

            if (eventName === 'esim.result') {
                renderEsimResult(eventData.r);
                const code = getEsimPayloadCode(eventData);
                const codeText = formatEsimResultCode(code);
                setEsimMetric('esimStatusValue', 'done');
                setEsimMessage(`eSIM 下载结果：${codeText}`, code === 0 ? '#16a34a' : '#dc2626');
                rejectEsimEventWaiters(makeEsimFlowStopError(`eSIM 下载结果：${codeText}`));
                releaseEsimRelayOwnership();
                return;
            }

            if (eventName === 'esim.list') {
                const code = getEsimPayloadCode(eventData);
                if (code !== undefined && code !== 0) {
                    setEsimMessage(`eSIM 列表查询失败：${formatEsimResultCode(code)}`, '#dc2626');
                } else {
                    renderEsimList(eventData);
                    setEsimMessage('eSIM profile 列表已更新。', '#16a34a');
                }
                return;
            }

            if (eventName === 'esim.enable' || eventName === 'esim.delete') {
                const code = getEsimPayloadCode(eventData);
                const ok = code === 0;
                setEsimMessage(`${eventName} ${ok ? '成功' : `失败：${formatEsimResultCode(code)}`}`, ok ? '#16a34a' : '#dc2626');
            }
        }

        // 设备进入引导模式（无可用 profile）后，每 60s 重发的引导提醒事件。
        // 形如 {"e":"esim-pending","r":{"st":"no_profile"},"ts":...}
        function handleEsimPendingEvent(eventData) {
            appendEsimEventLog(eventData);
            const reason = eventData && eventData.r && eventData.r.st ? eventData.r.st : 'pending';
            setEsimMetric('esimStatusValue', 'onboard');
            setEsimMessage(`设备处于 eSIM 引导模式（${reason}），请写入可用 profile。`, '#d97706');
        }

        const esimActivationInput = document.getElementById('esimActivationCode');
        if (esimActivationInput) {
            esimActivationInput.addEventListener('input', updateEsimActivationByteCount);
            updateEsimActivationByteCount();
        }

        function setWifiMessage(message, color = '#4b5563') {
            const el = document.getElementById('wifiMessage');
            if (!el) return;
            el.textContent = message || '';
            el.style.color = color;
        }

        function initWifiScanResults() {
            if (!globalThis.currentWifiScanResults) {
                globalThis.currentWifiScanResults = [];
            }
            globalThis.currentWifiScanResults = [];
            
            const container = document.getElementById('wifiScanResults');
            if (container) {
                container.innerHTML = '<div class="text-gray-500 text-sm">等待扫描结果...</div>';
            }
        }

        function addWifiScanResult(scanResult) {
            if (!globalThis.currentWifiScanResults) {
                globalThis.currentWifiScanResults = [];
            }
            
            // 检查是否已存在相同MAC地址的结果，如果存在则更新
            const existingIndex = globalThis.currentWifiScanResults.findIndex(item => item.m === scanResult.m);
            if (existingIndex >= 0) {
                globalThis.currentWifiScanResults[existingIndex] = scanResult;
            } else {
                globalThis.currentWifiScanResults.push(scanResult);
            }
            
            // 实时更新显示
            renderWifiScanResults({ r: globalThis.currentWifiScanResults });
            
            // 更新消息显示扫描到的数量
            setWifiMessage(`已扫描到 ${globalThis.currentWifiScanResults.length} 个 Wi-Fi 信标`, '#16a34a');
        }

        function handleWifiScanEvent(eventData) {
            if (eventData && eventData.e === 'wifi-scan' && eventData.r) {
                addWifiScanResult(eventData.r);
            }
        }

        function createTableCell(text, header = false) {
            const cell = document.createElement(header ? 'th' : 'td');
            cell.textContent = text ?? '';
            cell.className = header ? 'px-3 py-2 text-left text-gray-600 font-semibold' : 'px-3 py-2 text-gray-800 break-all';
            return cell;
        }

        function renderWifiStatus(payload) {
            const container = document.getElementById('wifiStatusDisplay');
            if (!container) return;
            container.innerHTML = '';

            const data = payload && typeof payload === 'object' ? payload.r : null;
            if (!data || typeof data !== 'object') {
                container.textContent = '尚未获取到 Wi-Fi 状态数据。';
                return;
            }

            const table = document.createElement('table');
            table.className = 'w-full text-sm border-collapse';
            const tbody = document.createElement('tbody');

            const rows = [
                ['状态', data.t !== undefined ? `${data.t} (${wifiConstants.stateMap[data.t] || '未知状态'})` : '未知'],
                ['Wi-Fi 名称 (SSID)', data.s || '-'],
                ['MAC 地址', data.m || '-'],
                ['信号强度 (RSSI)', data.r !== undefined ? `${data.r} dBm` : '-']
            ];

            rows.forEach(([label, value]) => {
                const tr = document.createElement('tr');
                const th = document.createElement('th');
                th.textContent = label;
                th.className = 'px-3 py-2 text-left text-gray-600 font-semibold';
                const td = document.createElement('td');
                td.textContent = value;
                td.className = 'px-3 py-2 text-gray-800 break-all';
                tr.appendChild(th);
                tr.appendChild(td);
                tbody.appendChild(tr);
            });

            table.appendChild(tbody);
            container.appendChild(table);
        }

        function renderWifiScanResults(payload) {
            const container = document.getElementById('wifiScanResults');
            if (!container) return;
            container.innerHTML = '';

            const list = payload && Array.isArray(payload.r) ? payload.r : [];
            if (!list.length) {
                container.textContent = '暂未扫描到可用 Wi-Fi 信标。';
                return;
            }

            const table = document.createElement('table');
            table.className = 'w-full text-sm border border-gray-200';

            const thead = document.createElement('thead');
            thead.className = 'bg-gray-100';
            const headerRow = document.createElement('tr');
            ['SSID', 'MAC 地址', '信号强度 (dBm)', '加密方式', '操作'].forEach(text => headerRow.appendChild(createTableCell(text, true)));
            thead.appendChild(headerRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            list.forEach(item => {
                const tr = document.createElement('tr');
                tr.className = 'odd:bg-white even:bg-gray-50';
                tr.appendChild(createTableCell(item.s || '-'));
                tr.appendChild(createTableCell(item.m || '-'));
                tr.appendChild(createTableCell(item.r !== undefined ? `${item.r}` : '-'));
                const encryptionLabel = item.e !== undefined ? `${item.e} (${wifiConstants.encryptionMap[item.e] || '未知'})` : '-';
                tr.appendChild(createTableCell(encryptionLabel));

                // 添加按钮
                const addTd = document.createElement('td');
                addTd.className = 'px-1 py-1';
                const addBtn = document.createElement('button');
                addBtn.className = 'cmd-button bg-green-500 hover:bg-green-700 text-white px-2 py-1 rounded text-xs';
                addBtn.textContent = '添加';
                addBtn.disabled = document.querySelectorAll('.cmd:not(:disabled)').length === 0;
                addBtn.onclick = async () => {
                    if (!item.m) return;
                    if (!item.s) {
                        setWifiMessage('扫描结果缺少 SSID，请手动填写后添加。', '#dc2626');
                        return;
                    }
                    const addPayload = buildWifiAddTagPayload(item.s || '', item.m);
                    if (!addPayload) return;
                    setWifiMessage('正在添加 Wi-Fi 信标...', '#2563eb');
                    const rsp = await sendAppCommandViaBle(JSON.stringify({ c: 'wifi.addtag', p: addPayload }), getWifiCommandOptions());
                    if (!rsp) {
                        setWifiMessage('添加 Wi-Fi 信标失败。', '#dc2626');
                        return;
                    }
                    const payload = safeJsonParse(rsp);
                    const result = payload && typeof payload === 'object' ? payload.r : null;
                    const message = wifiConstants.addResultMap[result] || `未知返回码：${result}`;
                    if (result === 0) {
                        setWifiMessage(message, '#16a34a');
                        await handleWifiQueryTags({ silent: true });
                    } else {
                        setWifiMessage(message, '#dc2626');
                    }
                };
                addTd.appendChild(addBtn);
                tr.appendChild(addTd);

                tbody.appendChild(tr);
            });

            table.appendChild(tbody);
            container.appendChild(table);
        }

        function renderWifiTagList(payload) {
            const container = document.getElementById('wifiTagList');
            if (!container) return;
            container.innerHTML = '';

            const list = payload && Array.isArray(payload.r) ? payload.r : [];
            if (!list.length) {
                container.textContent = '当前未保存任何 Wi-Fi 信标。';
                return;
            }

            const table = document.createElement('table');
            table.className = 'w-full text-sm border border-gray-200';

            const thead = document.createElement('thead');
            thead.className = 'bg-gray-100';
            const headerRow = document.createElement('tr');
            ['SSID', 'MAC 地址', '位置'].forEach(text => headerRow.appendChild(createTableCell(text, true)));
            headerRow.appendChild(createTableCell('操作', true));
            thead.appendChild(headerRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            list.forEach(item => {
                const tr = document.createElement('tr');
                tr.className = 'odd:bg-white even:bg-gray-50';

                tr.appendChild(createTableCell(item.s || '-'));
                tr.appendChild(createTableCell(item.m || '-'));
                tr.appendChild(createTableCell(formatWifiLocation(item.lat, item.lng)));

                // 删除按钮
                const delTd = document.createElement('td');
                delTd.className = 'px-1 py-1';
                const delBtn = document.createElement('button');
                delBtn.className = 'cmd-button bg-red-500 hover:bg-red-700 text-white px-2 py-1 rounded text-xs';
                delBtn.textContent = '删除';
                delBtn.disabled = document.querySelectorAll('.cmd:not(:disabled)').length === 0;
                delBtn.onclick = async () => {
                    if (!item.m) return;
                    setWifiMessage('正在删除 Wi-Fi 信标...', '#dc2626');
                    const rsp = await sendAppCommandViaBle(JSON.stringify({ c: 'wifi.deltag', p: { m: item.m } }), getWifiCommandOptions());
                    if (!rsp) {
                        setWifiMessage('删除 Wi-Fi 信标失败。', '#dc2626');
                        return;
                    }
                    const payload = safeJsonParse(rsp);
                    const result = payload && typeof payload === 'object' ? payload.r : null;
                    const message = wifiConstants.delResultMap[result] || `未知返回码：${result}`;
                    if (result === 0) {
                        setWifiMessage(message, '#16a34a');
                        await handleWifiQueryTags({ silent: true });
                    } else {
                        setWifiMessage(message, '#dc2626');
                    }
                };
                delTd.appendChild(delBtn);
                tr.appendChild(delTd);
                tbody.appendChild(tr);
            });

            table.appendChild(tbody);
            container.appendChild(table);
        }

        function validateMacAddress(mac) {
            const macPattern = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;
            return macPattern.test(mac.trim());
        }

        function formatWifiLocation(lat, lng) {
            const latNum = Number(lat);
            const lngNum = Number(lng);
            if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return '-';
            return `${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`;
        }

        function readWifiOptionalLocation() {
            const latInput = document.getElementById('wifiAddLat');
            const lngInput = document.getElementById('wifiAddLng');
            const latRaw = latInput ? latInput.value.trim() : '';
            const lngRaw = lngInput ? lngInput.value.trim() : '';

            if (!latRaw && !lngRaw) return { location: null };
            if (!latRaw || !lngRaw) {
                return { error: '经纬度需要同时填写；如果不需要位置，请清除两个输入框。' };
            }

            const lat = Number(latRaw);
            const lng = Number(lngRaw);
            if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
                return { error: '纬度 lat 必须是 -90 到 90 之间的数字。', focus: latInput };
            }
            if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
                return { error: '经度 lng 必须是 -180 到 180 之间的数字。', focus: lngInput };
            }

            return {
                location: {
                    lat: Number(lat.toFixed(6)),
                    lng: Number(lng.toFixed(6))
                }
            };
        }

        function buildWifiAddTagPayload(ssid, mac) {
            const locationResult = readWifiOptionalLocation();
            if (locationResult.error) {
                setWifiMessage(locationResult.error, '#dc2626');
                locationResult.focus && locationResult.focus.focus();
                return null;
            }

            const payload = { s: ssid, m: mac };
            if (locationResult.location) {
                payload.lat = locationResult.location.lat;
                payload.lng = locationResult.location.lng;
            }
            return payload;
        }

        function setWifiTagLocation(location) {
            if (!location) return;
            const lat = Number(location.lat);
            const lng = Number(location.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

            const latInput = document.getElementById('wifiAddLat');
            const lngInput = document.getElementById('wifiAddLng');
            if (latInput) latInput.value = lat.toFixed(6);
            if (lngInput) lngInput.value = lng.toFixed(6);
            setWifiMessage(`已选择 Wi-Fi 信标位置：${formatWifiLocation(lat, lng)}`, '#16a34a');
        }

        function clearWifiLocation() {
            const latInput = document.getElementById('wifiAddLat');
            const lngInput = document.getElementById('wifiAddLng');
            if (latInput) latInput.value = '';
            if (lngInput) lngInput.value = '';
            setWifiMessage('已清除 Wi-Fi 信标位置。', '#4b5563');
        }

        function openWifiLocationPicker() {
            const frame = document.getElementById('wifiLocationPickerFrame');
            if (!frame) return;

            const lat = document.getElementById('wifiAddLat')?.value.trim();
            const lng = document.getElementById('wifiAddLng')?.value.trim();
            const params = new URLSearchParams();
            if (lat && lng) {
                params.set('lat', lat);
                params.set('lng', lng);
            }
            frame.src = `wifi-location-picker.html${params.toString() ? `?${params}` : ''}`;
            frame.style.display = 'block';
            setTimeout(() => {
                try {
                    frame.contentWindow && frame.contentWindow.postMessage({ type: 'wifi-location-picker-resize' }, '*');
                } catch (error) {
                    console.warn('无法通知地图选点器调整大小:', error);
                }
            }, 250);
        }

        function closeWifiLocationPicker() {
            const frame = document.getElementById('wifiLocationPickerFrame');
            if (frame) frame.style.display = 'none';
        }

        window.addEventListener('message', (event) => {
            if (!event.data || event.data.type !== 'wifi-location-selected') return;
            setWifiTagLocation(event.data);
            closeWifiLocationPicker();
        });

        async function handleWifiStatus() {
            setWifiMessage('正在查询 Wi-Fi 状态...', '#2563eb');
            const rsp = await sendAppCommandViaBle(JSON.stringify({ c: 'wifi.status' }), getWifiCommandOptions());
            if (!rsp) {
                setWifiMessage('查询 Wi-Fi 状态失败。', '#dc2626');
                return;
            }
            const payload = safeJsonParse(rsp);
            if (!payload) {
                setWifiMessage('无法解析 Wi-Fi 状态响应。', '#dc2626');
                return;
            }
            renderWifiStatus(payload);
            setWifiMessage('Wi-Fi 状态已更新。', '#16a34a');
        }

        async function handleWifiEnable() {
            const freqInput = document.getElementById('wifiScanFrequency');
            const lostCountInput = document.getElementById('wifiLostCount');
            let frequency = parseInt(freqInput.value, 10);
            let lostCount = parseInt(lostCountInput.value, 10);
            
            if (isNaN(frequency) || frequency < 30) {
                setWifiMessage('扫描频率必须至少为 30 秒。', '#dc2626');
                return;
            }
            if (isNaN(lostCount) || lostCount < 1) {
                setWifiMessage('最大未检测到信标次数必须至少为 1。', '#dc2626');
                return;
            }
            
            setWifiMessage('正在开启 Wi-Fi 信标功能...', '#2563eb');
            const cmd = JSON.stringify({ c: 'wifi.enable', p: { f: frequency, l: lostCount } });
            const rsp = await sendAppCommandViaBle(cmd, getWifiCommandOptions());
            
            if (!rsp) {
                setWifiMessage('开启 Wi-Fi 信标功能失败。', '#dc2626');
                return;
            }
            const payload = safeJsonParse(rsp);
            const result = payload && typeof payload === 'object' ? payload.r : null;
            if (result === 0) setWifiMessage('Wi-Fi 信标功能已开启。', '#16a34a');
            else setWifiMessage(`开启失败：${result !== null ? `代码 ${result}` : '未知原因'}`, '#dc2626');
        }

        async function handleWifiDisable() {
            setWifiMessage('正在关闭 Wi-Fi 信标功能...', '#2563eb');
            const rsp = await sendAppCommandViaBle(JSON.stringify({ c: 'wifi.disable' }), getWifiCommandOptions());
            if (!rsp) {
                setWifiMessage('关闭 Wi-Fi 信标功能失败。', '#dc2626');
                return;
            }
            const payload = safeJsonParse(rsp);
            const result = payload && typeof payload === 'object' ? payload.r : null;
            if (result === 0) setWifiMessage('Wi-Fi 信标功能已关闭。', '#16a34a');
            else setWifiMessage(`关闭失败：${result !== null ? `代码 ${result}` : '未知原因'}`, '#dc2626');
        }

        async function handleWifiScan() {
            // 初始化扫描结果显示
            initWifiScanResults();
            setWifiMessage('正在扫描附近的 Wi-Fi 信标...', '#2563eb');
            
            const rsp = await sendAppCommandViaBle(JSON.stringify({ c: 'wifi.scan' }), getWifiCommandOptions());
            if (!rsp) {
                setWifiMessage('触发 Wi-Fi 扫描失败。', '#dc2626');
                return;
            }
            
            // 解析响应，只检查扫描命令是否被确认
            const payload = safeJsonParse(rsp);
            if (payload && payload.c === 'wifi.scan' && payload.r === 0) {
                setWifiMessage('Wi-Fi 扫描已启动，正在等待结果...', '#2563eb');
            } else {
                setWifiMessage('Wi-Fi 扫描命令执行失败。', '#dc2626');
            }
        }

        async function handleWifiAddTag() {
            const ssidInput = document.getElementById('wifiAddSsid');
            const macInput = document.getElementById('wifiAddMac');
            const ssid = ssidInput ? ssidInput.value.trim() : '';
            const mac = macInput ? macInput.value.trim() : '';

            if (!ssid) {
                setWifiMessage('请输入要添加的 SSID。', '#dc2626');
                ssidInput && ssidInput.focus();
                return;
            }
            if (!mac) {
                setWifiMessage('请输入要添加的 MAC 地址。', '#dc2626');
                macInput && macInput.focus();
                return;
            }
            if (!validateMacAddress(mac)) {
                setWifiMessage('MAC 地址格式不正确，请使用冒号分隔的 6 组十六进制数字。', '#dc2626');
                macInput && macInput.focus();
                return;
            }

            const addPayload = buildWifiAddTagPayload(ssid, mac);
            if (!addPayload) return;

            setWifiMessage('正在添加 Wi-Fi 信标...', '#2563eb');
            const rsp = await sendAppCommandViaBle(JSON.stringify({ c: 'wifi.addtag', p: addPayload }), getWifiCommandOptions());
            if (!rsp) {
                setWifiMessage('添加 Wi-Fi 信标失败。', '#dc2626');
                return;
            }
            const payload = safeJsonParse(rsp);
            const result = payload && typeof payload === 'object' ? payload.r : null;
            const message = wifiConstants.addResultMap[result] || `未知返回码：${result}`;
            if (result === 0) {
                setWifiMessage(message, '#16a34a');
                if (ssidInput) ssidInput.value = '';
                if (macInput) macInput.value = '';
                const latInput = document.getElementById('wifiAddLat');
                const lngInput = document.getElementById('wifiAddLng');
                if (latInput) latInput.value = '';
                if (lngInput) lngInput.value = '';
                await handleWifiQueryTags({ silent: true });
            } else {
                setWifiMessage(message, '#dc2626');
            }
        }

        async function handleWifiDeleteTag() {
            const macInput = document.getElementById('wifiDeleteMac');
            const mac = macInput ? macInput.value.trim() : '';
            if (!mac) {
                setWifiMessage('请输入要删除的 MAC 地址。', '#dc2626');
                macInput && macInput.focus();
                return;
            }
            if (!validateMacAddress(mac)) {
                setWifiMessage('MAC 地址格式不正确，请使用冒号分隔的 6 组十六进制数字。', '#dc2626');
                macInput && macInput.focus();
                return;
            }

            setWifiMessage('正在删除 Wi-Fi 信标...', '#2563eb');
            const rsp = await sendAppCommandViaBle(JSON.stringify({ c: 'wifi.deltag', p: { m: mac } }), getWifiCommandOptions());
            if (!rsp) {
                setWifiMessage('删除 Wi-Fi 信标失败。', '#dc2626');
                return;
            }
            const payload = safeJsonParse(rsp);
            const result = payload && typeof payload === 'object' ? payload.r : null;
            const message = wifiConstants.delResultMap[result] || `未知返回码：${result}`;
            if (result === 0) {
                setWifiMessage(message, '#16a34a');
                if (macInput) macInput.value = '';
                await handleWifiQueryTags({ silent: true });
            } else {
                setWifiMessage(message, '#dc2626');
            }
        }

        async function handleWifiQueryTags(options = {}) {
            const { silent = false } = options;
            if (!silent) setWifiMessage('正在查询已保存的 Wi-Fi 信标...', '#2563eb');
            const rsp = await sendAppCommandViaBle(JSON.stringify({ c: 'wifi.querytag' }), getWifiCommandOptions());
            if (!rsp) {
                if (!silent) setWifiMessage('查询 Wi-Fi 信标列表失败。', '#dc2626');
                return;
            }
            const payload = safeJsonParse(rsp);
            if (!payload) {
                if (!silent) setWifiMessage('无法解析 Wi-Fi 信标列表响应。', '#dc2626');
                return;
            }
            renderWifiTagList(payload);
            if (!silent) setWifiMessage('Wi-Fi 信标列表已更新。', '#16a34a');
        }

        // --- Specific command handlers ---

        function handleAppActivateFence() {
            const fidInput = document.getElementById('app_fe1_param_fid');
            const fid = fidInput.value.trim();
            if (!fid) { alert('请输入要激活的围栏ID (Please enter Fence ID to activate)'); fidInput.focus(); return; }
            const command = { c: 'fe1', p: [fid] };
            sendAppCommandViaBle(JSON.stringify(command));
        }

        function handleAppDeactivateFence() {
            const fidInput = document.getElementById('app_fe0_param_fid');
            const fid = fidInput.value.trim();
            if (!fid) { alert('请输入要禁用的围栏ID (Please enter Fence ID to disable)'); fidInput.focus(); return; }
            const command = { c: 'fe0', p: [fid] };
            sendAppCommandViaBle(JSON.stringify(command));
        }

        function handleAppDeleteFence() {
            const fidsInput = document.getElementById('app_fd_param_fids');
            const fidsStr = fidsInput.value.trim();
            if (!fidsStr) { alert('请输入要删除的围栏ID列表，以逗号分隔 (Please enter Fence IDs to delete, comma-separated)'); fidsInput.focus(); return; }
            const fidsArray = fidsStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
            if (fidsArray.length === 0) { alert('请输入有效的围栏ID (Please enter valid Fence IDs)'); fidsInput.focus(); return; }
            const command = { c: 'fd', p: fidsArray };
            sendAppCommandViaBle(JSON.stringify(command));
        }

        function handleAppSetFenceParams() {
            const paddingInput = document.getElementById('app_sfp1_padding');
            const marginInput = document.getElementById('app_sfp1_margin');
            const padding = parseFloat(paddingInput.value);
            const margin = parseFloat(marginInput.value);

            if (isNaN(padding)) { alert('请输入有效的Padding值 (Please enter a valid Padding value)'); paddingInput.focus(); return; }
            if (isNaN(margin)) { alert('请输入有效的Margin值 (Please enter a valid Margin value)'); marginInput.focus(); return; }

            const command = { c: 'sfp1', p: [padding, margin] };
            sendAppCommandViaBle(JSON.stringify(command));
        }

        function handleAppDebugEventGnss() {
            const typeInput = document.getElementById('app_debug_event_type');
            const latInput = document.getElementById('app_debug_event_lat');
            const lngInput = document.getElementById('app_debug_event_lng');

            const type = parseInt(typeInput.value);
            const lat = parseFloat(latInput.value);
            const lng = parseFloat(lngInput.value);

            if (isNaN(type) || type < 1 || type > 6) { alert('请输入有效的Type值 (1-6) (Please enter a valid Type value (1-6))'); typeInput.focus(); return; }
            if (isNaN(lat)) { alert('请输入有效的Latitude值 (Please enter a valid Latitude value)'); latInput.focus(); return; }
            if (isNaN(lng)) { alert('请输入有效的Longitude值 (Please enter a valid Longitude value)'); lngInput.focus(); return; }

            const command = { c: 'debug.event_gnss', p: { type: type, lat: lat, lng: lng } };
            sendAppCommandViaBle(JSON.stringify(command));
        }

        // 父页面JS
        function receiveAmapFenceData(data) {
            const openEditBtn = document.getElementById('openEditorBtn');
            console.log("从围栏编辑器接收到的数据:", data);
            openEditBtn.disabled = false;
            displayReceivedData(data);

            closeFenceEditor(); // 关闭编辑器模态框
        }

        function formatCoordinates(pointsArray) {
            if (!pointsArray || pointsArray.length === 0) return "无坐标点";
            let formatted = [];
            for (let i = 0; i < pointsArray.length; i += 2) {
                if (pointsArray[i+1] !== undefined) {
                    formatted.push(`[${pointsArray[i].toFixed(6)}, ${pointsArray[i+1].toFixed(6)}]`);
                }
            }
            return formatted.join(', ');
        }
        function displayReceivedData(data) {
            const dataListDiv = document.getElementById('dataList');
            if (!data) { // 检查 data 是否存在
                dataListDiv.innerHTML = '<p class="text-gray-500 italic">接收到的数据为空或无效。</p>';
                return;
            }
            // 将接收到的数据对象转换为格式化的JSON字符串
            const jsonString = JSON.stringify(data); // null, 2 用于美化输出（缩进2个空格）
            try {
                sendAppCommandViaBle(jsonString);
            } catch (e) {
                alert('添加围栏参数JSON无效 (Invalid JSON for Add Fence parameters): ' + e.message);
                console.error('Invalid JSON for Add Fence:', e);
                paramJsonTextarea.focus();
            }
            // 将JSON字符串包裹在<pre>标签中以保持格式，并应用Tailwind样式
            dataListDiv.innerHTML = `<pre class="bg-white p-3 border border-gray-200 rounded-md text-sm shadow overflow-auto max-h-96">${jsonString}</pre>`;
        }

        function postMessageToFenceEditor(type, payload = {}) {
            const iframe = document.getElementById('fenceEditorFrame');
            if (!iframe) return;
            const message = { source: 'index-parent', type, payload };
            try {
                if (iframe.contentWindow) {
                    iframe.contentWindow.postMessage(message, '*');
                }
            } catch (error) {
                console.warn('无法向围栏编辑器发送消息:', error);
            }
        }

        // 父页面JS
        function openFenceEditor() {
            const iframe = document.getElementById('fenceEditorFrame');
            if (!iframe) return;
            iframe.style.display = 'block';
            console.log("打开编辑器模态框");
            postMessageToFenceEditor('open-editor');
        }

        function editorModalClosed() {
            console.log("编辑器模态框已由iframe内部关闭。");
             if (document.getElementById('fenceEditorFrame').style.display !== 'none') {
                closeFenceEditor();
            }
        }

        function closeFenceEditor() {
            const iframe = document.getElementById('fenceEditorFrame');
            if (!iframe) return;
            const wasVisible = iframe.style.display !== 'none';
            iframe.style.display = 'none';
            if (wasVisible) {
                postMessageToFenceEditor('close-editor');
            }
        }

        window.addEventListener('message', event => {
            const data = event.data;
            if (!data || data.source !== 'gps-editor') return;
            if (data.type === 'editorModalClosed') {
                editorModalClosed();
            } else if (data.type === 'fence-data') {
                receiveAmapFenceData(data.payload);
            } else if (data.type === 'log') {
                console.log('[GPS EDITOR]', data.payload);
            } else if (data.type === 'editor-ready') {
                console.log('[GPS EDITOR] ready state:', data.payload);
            }
        });

        function crc8(current, previous = 0) {
            const TABLE = [
                0x00, 0x07, 0x0e, 0x09, 0x1c, 0x1b, 0x12, 0x15, 0x38, 0x3f, 0x36, 0x31, 0x24, 0x23, 0x2a, 0x2d,
                0x70, 0x77, 0x7e, 0x79, 0x6c, 0x6b, 0x62, 0x65, 0x48, 0x4f, 0x46, 0x41, 0x54, 0x53, 0x5a, 0x5d,
                0xe0, 0xe7, 0xee, 0xe9, 0xfc, 0xfb, 0xf2, 0xf5, 0xd8, 0xdf, 0xd6, 0xd1, 0xc4, 0xc3, 0xca, 0xcd,
                0x90, 0x97, 0x9e, 0x99, 0x8c, 0x8b, 0x82, 0x85, 0xa8, 0xaf, 0xa6, 0xa1, 0xb4, 0xb3, 0xba, 0xbd,
                0xc7, 0xc0, 0xc9, 0xce, 0xdb, 0xdc, 0xd5, 0xd2, 0xff, 0xf8, 0xf1, 0xf6, 0xe3, 0xe4, 0xed, 0xea,
                0xb7, 0xb0, 0xb9, 0xbe, 0xab, 0xac, 0xa5, 0xa2, 0x8f, 0x88, 0x81, 0x86, 0x93, 0x94, 0x9d, 0x9a,
                0x27, 0x20, 0x29, 0x2e, 0x3b, 0x3c, 0x35, 0x32, 0x1f, 0x18, 0x11, 0x16, 0x03, 0x04, 0x0d, 0x0a,
                0x57, 0x50, 0x59, 0x5e, 0x4b, 0x4c, 0x45, 0x42, 0x6f, 0x68, 0x61, 0x66, 0x73, 0x74, 0x7d, 0x7a,
                0x89, 0x8e, 0x87, 0x80, 0x95, 0x92, 0x9b, 0x9c, 0xb1, 0xb6, 0xbf, 0xb8, 0xad, 0xaa, 0xa3, 0xa4,
                0xf9, 0xfe, 0xf7, 0xf0, 0xe5, 0xe2, 0xeb, 0xec, 0xc1, 0xc6, 0xcf, 0xc8, 0xdd, 0xda, 0xd3, 0xd4,
                0x69, 0x6e, 0x67, 0x60, 0x75, 0x72, 0x7b, 0x7c, 0x51, 0x56, 0x5f, 0x58, 0x4d, 0x4a, 0x43, 0x44,
                0x19, 0x1e, 0x17, 0x10, 0x05, 0x02, 0x0b, 0x0c, 0x21, 0x26, 0x2f, 0x28, 0x3d, 0x3a, 0x33, 0x34,
                0x4e, 0x49, 0x40, 0x47, 0x52, 0x55, 0x5c, 0x5b, 0x76, 0x71, 0x78, 0x7f, 0x6a, 0x6d, 0x64, 0x63,
                0x3e, 0x39, 0x30, 0x37, 0x22, 0x25, 0x2c, 0x2b, 0x06, 0x01, 0x08, 0x0f, 0x1a, 0x1d, 0x14, 0x13,
                0xae, 0xa9, 0xa0, 0xa7, 0xb2, 0xb5, 0xbc, 0xbb, 0x96, 0x91, 0x98, 0x9f, 0x8a, 0x8d, 0x84, 0x83,
                0xde, 0xd9, 0xd0, 0xd7, 0xc2, 0xc5, 0xcc, 0xcb, 0xe6, 0xe1, 0xe8, 0xef, 0xfa, 0xfd, 0xf4, 0xf3,
            ];
            let crc = ~~previous;
            for (let index = 0; index < current.length; index++) {
                crc = TABLE[(crc ^ current[index]) & 0xff] & 0xff;
            }
            return crc;
        }

        Object.assign(window, {
            scanBleDevices,
            connectSelectedDevice,
            disconnectBleDevice,
            chooseFile,
            sendCert,
            sendFile,
            sendCmdAndWaitForOK,
            clearEventMessages,
            sendAppCommandViaBle,
            handleNtnEnterOnlyMode,
            handleNtnExitOnlyMode,
            handleNtnStatus,
            handleNtnEnvQuery,
            handleNtnEnvSet,
            handleNtnSmsSend,
            handleAppActivateFence,
            handleAppDeactivateFence,
            handleAppDeleteFence,
            handleAppSetFenceParams,
            handleAppDebugEventGnss,
            openFenceEditor,
            handleWifiEnable,
            handleWifiDisable,
            handleWifiStatus,
            handleWifiScan,
            handleWifiAddTag,
            handleWifiDeleteTag,
            handleWifiQueryTags,
            handleEsimStart,
            handleEsimCancel,
            handleEsimList,
            handleEsimEnable,
            handleEsimDelete,
            handleEsimOnboardEnter,
            handleEsimOnboardExit,
            openWifiLocationPicker,
            clearWifiLocation
        });
