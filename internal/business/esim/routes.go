package esim

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const maxHTTPSResponseBytes = 8 << 20

var (
	traceMu    sync.Mutex
	traceLines []string
)

type httpsRelayRequest struct {
	URL         string `json:"url"`
	Body        string `json:"body,omitempty"`
	SMDPAddress string `json:"smdpAddress,omitempty"`
	SMDPHost    string `json:"smdpHost,omitempty"`
}

func RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/esim/https", handleHTTPSRelay)
	mux.HandleFunc("/api/esim/trace", handleTrace)
}

func handleHTTPSRelay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 POST")
		return
	}

	var req httpsRelayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}

	fallbackSMDPAddress := strings.TrimSpace(req.SMDPAddress)
	if fallbackSMDPAddress == "" {
		fallbackSMDPAddress = strings.TrimSpace(req.SMDPHost)
	}

	targetURL, err := resolveTargetURL(req.URL, req.Body, fallbackSMDPAddress)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	method := http.MethodGet
	var body io.Reader
	if req.Body != "" {
		method = http.MethodPost
		body = strings.NewReader(req.Body)
	}

	outReq, err := http.NewRequestWithContext(r.Context(), method, targetURL, body)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	applyGSMAHTTPSHeaders(outReq)
	if req.Body != "" {
		outReq.Header.Set("Content-Type", "application/json")
		outReq.Header.Set("charset", "utf-8")
	}

	client, err := newHTTPSClient()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	startedAt := time.Now()
	recordTrace("HTTPS relay start method=%s url=%s body=%d smdp=%s direct=true", method, targetURL, len(req.Body), fallbackSMDPAddress)
	resp, err := client.Do(outReq)
	if err != nil {
		recordTrace("HTTPS relay failed url=%s duration=%s err=%v", targetURL, time.Since(startedAt), err)
		writeJSONError(w, http.StatusBadGateway, fmt.Sprintf("HTTPS 请求失败: %v", err))
		return
	}
	defer resp.Body.Close()

	payload, err := readLimited(resp.Body, maxHTTPSResponseBytes)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	duration := time.Since(startedAt)
	recordTrace("HTTPS relay done url=%s status=%d body=%d duration=%s", targetURL, resp.StatusCode, len(payload), duration)

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Esim-Direct", "1")
	w.Header().Set("X-Esim-HTTP-Status", fmt.Sprintf("%d", resp.StatusCode))
	w.Header().Set("X-Esim-Resolved-URL", targetURL)
	w.Header().Set("X-Esim-HTTP-Duration-Ms", fmt.Sprintf("%d", duration.Milliseconds()))
	if contentType := resp.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("X-Esim-HTTP-Content-Type", contentType)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}

func applyGSMAHTTPSHeaders(req *http.Request) {
	req.Header.Set("X-Admin-Protocol", "gsma/rsp/v2.2.0")
	req.Header.Set("User-Agent", "gsma-rsp-lpad")
	req.Host = httpsHostHeader(req.URL)
}

func httpsHostHeader(target *url.URL) string {
	if target == nil {
		return ""
	}
	if target.Port() != "" {
		return target.Host
	}
	if strings.EqualFold(target.Scheme, "https") {
		return net.JoinHostPort(target.Hostname(), "443")
	}
	return target.Host
}

func handleTrace(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 GET")
		return
	}

	traceMu.Lock()
	lines := append([]string(nil), traceLines...)
	traceMu.Unlock()
	if lines == nil {
		lines = []string{}
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{"lines": lines})
}

func recordTrace(format string, args ...any) {
	line := time.Now().Format("15:04:05.000 ") + fmt.Sprintf(format, args...)
	log.Printf("[esim] %s", line)

	traceMu.Lock()
	defer traceMu.Unlock()
	traceLines = append(traceLines, line)
	if len(traceLines) > 80 {
		traceLines = traceLines[len(traceLines)-80:]
	}
}

func newHTTPSClient() (*http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.TLSClientConfig = &tls.Config{
		InsecureSkipVerify: true,
	}

	return &http.Client{
		Timeout:   60 * time.Second,
		Transport: transport,
	}, nil
}

func resolveTargetURL(raw, body, fallbackSMDPAddress string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", fmt.Errorf("url 不能为空")
	}

	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("url 格式错误: %w", err)
	}
	if parsed.Scheme == "" && parsed.Host == "" && strings.HasPrefix(value, "/") {
		host, err := smdpHost(body, fallbackSMDPAddress)
		if err != nil {
			return "", err
		}
		target := url.URL{
			Scheme:   "https",
			Host:     host,
			Path:     parsed.Path,
			RawQuery: parsed.RawQuery,
		}
		return target.String(), nil
	}
	if parsed.Scheme != "https" {
		return "", fmt.Errorf("只允许 HTTPS URL")
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("url host 不能为空")
	}
	return parsed.String(), nil
}

func smdpHost(body, fallbackSMDPAddress string) (string, error) {
	if strings.TrimSpace(body) != "" {
		var payload struct {
			SMDPAddress string `json:"smdpAddress"`
		}
		if err := json.Unmarshal([]byte(body), &payload); err == nil {
			if strings.TrimSpace(payload.SMDPAddress) != "" {
				return normalizeSMDPHost(payload.SMDPAddress)
			}
		} else if strings.TrimSpace(fallbackSMDPAddress) == "" {
			return "", fmt.Errorf("relative URL needs body.smdpAddress or request smdpAddress; body must be JSON: %w", err)
		}
	}

	if strings.TrimSpace(fallbackSMDPAddress) != "" {
		return normalizeSMDPHost(fallbackSMDPAddress)
	}

	return "", fmt.Errorf("relative URL needs body.smdpAddress or request smdpAddress")
}

func normalizeSMDPHost(address string) (string, error) {
	address = strings.TrimSpace(address)
	if address == "" {
		return "", fmt.Errorf("smdpAddress cannot be empty")
	}

	if strings.Contains(address, "://") {
		parsed, err := url.Parse(address)
		if err != nil {
			return "", fmt.Errorf("smdpAddress format error: %w", err)
		}
		if parsed.Scheme != "https" {
			return "", fmt.Errorf("smdpAddress only allows HTTPS")
		}
		if parsed.Host == "" {
			return "", fmt.Errorf("smdpAddress host cannot be empty")
		}
		return parsed.Host, nil
	}

	parsed, err := url.Parse("https://" + address)
	if err != nil {
		return "", fmt.Errorf("smdpAddress format error: %w", err)
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("smdpAddress host cannot be empty")
	}
	return parsed.Host, nil
}

func smdpHostFromBody(body string) (string, error) {
	var payload struct {
		SMDPAddress string `json:"smdpAddress"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return "", fmt.Errorf("相对 URL 需要 body.smdpAddress，且 body 必须是 JSON: %w", err)
	}

	address := strings.TrimSpace(payload.SMDPAddress)
	if address == "" {
		return "", fmt.Errorf("相对 URL 需要 body.smdpAddress")
	}

	if strings.Contains(address, "://") {
		parsed, err := url.Parse(address)
		if err != nil {
			return "", fmt.Errorf("smdpAddress 格式错误: %w", err)
		}
		if parsed.Scheme != "https" {
			return "", fmt.Errorf("smdpAddress 只允许 HTTPS")
		}
		if parsed.Host == "" {
			return "", fmt.Errorf("smdpAddress host 不能为空")
		}
		return parsed.Host, nil
	}

	parsed, err := url.Parse("https://" + address)
	if err != nil {
		return "", fmt.Errorf("smdpAddress 格式错误: %w", err)
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("smdpAddress host 不能为空")
	}
	return parsed.Host, nil
}

func readLimited(reader io.Reader, limit int64) ([]byte, error) {
	var buf bytes.Buffer
	limited := io.LimitReader(reader, limit+1)
	if _, err := buf.ReadFrom(limited); err != nil {
		return nil, err
	}
	if int64(buf.Len()) > limit {
		return nil, fmt.Errorf("HTTPS 响应体超过 %d 字节上限", limit)
	}
	return buf.Bytes(), nil
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
