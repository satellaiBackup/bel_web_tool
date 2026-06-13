package nmea

import (
	"encoding/json"
	"net/http"
)

type generateResponse struct {
	Lines []string  `json:"lines"`
	State ToolState `json:"state"`
}

type replayLoadRequest struct {
	FileName string `json:"fileName"`
	Content  string `json:"content"`
}

func RegisterRoutes(mux *http.ServeMux) {
	manager := NewManager()
	manager.registerRoutes(mux)
}

func (m *Manager) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/nmea/ports", m.handlePorts)
	mux.HandleFunc("/api/nmea/state", m.handleState)
	mux.HandleFunc("/api/nmea/config", m.handleConfig)
	mux.HandleFunc("/api/nmea/serial/open", m.handleOpenSerial)
	mux.HandleFunc("/api/nmea/serial/close", m.handleCloseSerial)
	mux.HandleFunc("/api/nmea/generate", m.handleGenerate)
	mux.HandleFunc("/api/nmea/start", m.handleStartGenerate)
	mux.HandleFunc("/api/nmea/stop", m.handleStop)
	mux.HandleFunc("/api/nmea/replay/load", m.handleLoadReplay)
	mux.HandleFunc("/api/nmea/replay/start", m.handleStartReplay)
	mux.HandleFunc("/api/nmea/replay/stop", m.handleStop)
}

func (m *Manager) handlePorts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 GET")
		return
	}

	ports, err := ListSerialPorts()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ports": ports})
}

func (m *Manager) handleState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 GET")
		return
	}
	writeJSON(w, http.StatusOK, m.State())
}

func (m *Manager) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, m.State().Config)
	case http.MethodPost:
		var config ToolConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			writeJSONError(w, http.StatusBadRequest, "请求体格式错误")
			return
		}
		state, err := m.UpdateConfig(config)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, state)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 GET / POST")
	}
}

func (m *Manager) handleOpenSerial(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 POST")
		return
	}

	var config SerialConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		writeJSONError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}

	state, err := m.OpenSerial(config)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (m *Manager) handleCloseSerial(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 POST")
		return
	}

	state, err := m.CloseSerial()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (m *Manager) handleGenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 POST")
		return
	}

	var settings GeneratorSettings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		writeJSONError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}

	lines, state, err := m.Generate(settings)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, generateResponse{Lines: lines, State: state})
}

func (m *Manager) handleStartGenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 POST")
		return
	}

	var settings GeneratorSettings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		writeJSONError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}

	state, err := m.StartGenerate(settings)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (m *Manager) handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 POST")
		return
	}

	m.Stop()
	writeJSON(w, http.StatusOK, m.State())
}

func (m *Manager) handleLoadReplay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 POST")
		return
	}

	var req replayLoadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if req.Content == "" {
		writeJSONError(w, http.StatusBadRequest, "回放文件内容不能为空")
		return
	}

	state, err := m.LoadReplay(req.FileName, req.Content)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (m *Manager) handleStartReplay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 POST")
		return
	}

	var settings ReplaySettings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		writeJSONError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}

	state, err := m.StartReplay(settings)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
