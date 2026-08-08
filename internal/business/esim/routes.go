package esim

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
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

type HTTPSRelayConfig struct {
	AllowedHosts        []string
	CACertFiles         []string
	MaxRequestBodyBytes int64
	RootDir             string
}

type httpsRelay struct {
	allowedAuthorities  map[string]struct{}
	client              *http.Client
	maxRequestBodyBytes int64
}

func RegisterRoutes(mux *http.ServeMux, config HTTPSRelayConfig) error {
	relay, err := newHTTPSRelay(config)
	if err != nil {
		return fmt.Errorf("configure eSIM HTTPS relay: %w", err)
	}

	mux.HandleFunc("/api/esim/https", relay.handleHTTPSRelay)
	mux.HandleFunc("/api/esim/trace", handleTrace)
	return nil
}

func newHTTPSRelay(config HTTPSRelayConfig) (*httpsRelay, error) {
	if config.MaxRequestBodyBytes <= 0 {
		return nil, fmt.Errorf("maxRequestBodyBytes must be positive")
	}

	allowedAuthorities, err := buildAllowedAuthorities(config.AllowedHosts)
	if err != nil {
		return nil, err
	}
	client, err := newHTTPSClient(config.RootDir, config.CACertFiles)
	if err != nil {
		return nil, err
	}

	relay := &httpsRelay{
		allowedAuthorities:  allowedAuthorities,
		client:              client,
		maxRequestBodyBytes: config.MaxRequestBodyBytes,
	}
	relay.client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return fmt.Errorf("stopped after 10 redirects")
		}
		if !relay.targetAllowed(req.URL.String()) {
			return fmt.Errorf("redirect target is not allowed by SMDP+ policy")
		}
		return nil
	}
	return relay, nil
}

func (h *httpsRelay) handleHTTPSRelay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "只支持 POST")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, h.maxRequestBodyBytes)
	var req httpsRelayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeJSONError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("请求体超过 %d 字节上限", h.maxRequestBodyBytes))
			return
		}
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
	if !h.targetAllowed(targetURL) {
		writeJSONError(w, http.StatusForbidden, "SMDP+ target is not allowed by policy")
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

	startedAt := time.Now()
	recordTrace("HTTPS relay start method=%s url=%s body=%d smdp=%s direct=true", method, targetURL, len(req.Body), fallbackSMDPAddress)
	resp, err := h.client.Do(outReq)
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
	relayPayload, err := serializeHTTPSResponse(resp, payload)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	duration := time.Since(startedAt)
	recordTrace("HTTPS relay done url=%s status=%d body=%d response=%d duration=%s", targetURL, resp.StatusCode, len(payload), len(relayPayload), duration)

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Esim-Direct", "1")
	w.Header().Set("X-Esim-HTTP-Status", fmt.Sprintf("%d", resp.StatusCode))
	w.Header().Set("X-Esim-HTTP-Body-Bytes", fmt.Sprintf("%d", len(payload)))
	w.Header().Set("X-Esim-HTTP-Response-Bytes", fmt.Sprintf("%d", len(relayPayload)))
	w.Header().Set("X-Esim-Resolved-URL", targetURL)
	w.Header().Set("X-Esim-HTTP-Duration-Ms", fmt.Sprintf("%d", duration.Milliseconds()))
	if contentType := resp.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("X-Esim-HTTP-Content-Type", contentType)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(relayPayload)
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

func serializeHTTPSResponse(resp *http.Response, body []byte) ([]byte, error) {
	relayResp := *resp
	relayResp.Header = resp.Header.Clone()
	relayResp.Body = io.NopCloser(bytes.NewReader(body))
	relayResp.ContentLength = int64(len(body))
	relayResp.TransferEncoding = nil
	relayResp.Close = false
	if relayResp.Header.Get("Content-Length") == "" {
		relayResp.Header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
	}

	var raw bytes.Buffer
	if err := relayResp.Write(&raw); err != nil {
		return nil, fmt.Errorf("serialize HTTPS response: %w", err)
	}
	return raw.Bytes(), nil
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

func newHTTPSClient(rootDir string, caCertFiles []string) (*http.Client, error) {
	rootCAs, err := loadRootCAs(rootDir, caCertFiles)
	if err != nil {
		return nil, err
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DisableCompression = true
	transport.TLSClientConfig = &tls.Config{
		MinVersion: tls.VersionTLS12,
		RootCAs:    rootCAs,
	}

	return &http.Client{
		Timeout:   60 * time.Second,
		Transport: transport,
	}, nil
}

func loadRootCAs(rootDir string, caCertFiles []string) (*x509.CertPool, error) {
	if len(caCertFiles) == 0 {
		return nil, nil
	}

	pool, err := x509.SystemCertPool()
	if err != nil {
		return nil, fmt.Errorf("load system CA pool: %w", err)
	}
	if pool == nil {
		pool = x509.NewCertPool()
	}

	for _, configuredPath := range caCertFiles {
		resolvedPath, err := resolveCAFilePath(rootDir, configuredPath)
		if err != nil {
			return nil, err
		}
		pemData, err := os.ReadFile(resolvedPath)
		if err != nil {
			return nil, fmt.Errorf("read CA certificate %q: %w", configuredPath, err)
		}
		if !pool.AppendCertsFromPEM(pemData) {
			return nil, fmt.Errorf("CA certificate %q does not contain a valid PEM certificate", configuredPath)
		}
	}

	return pool, nil
}

func resolveCAFilePath(rootDir, configuredPath string) (string, error) {
	configuredPath = strings.TrimSpace(configuredPath)
	if configuredPath == "" {
		return "", fmt.Errorf("CA certificate path must not be empty")
	}
	if rootDir == "" {
		return "", fmt.Errorf("application root is required for CA certificate files")
	}
	if filepath.IsAbs(configuredPath) {
		return "", fmt.Errorf("CA certificate path %q must be relative to the application root", configuredPath)
	}

	rootPath, err := filepath.Abs(rootDir)
	if err != nil {
		return "", fmt.Errorf("resolve application root: %w", err)
	}
	candidatePath, err := filepath.Abs(filepath.Join(rootPath, filepath.Clean(configuredPath)))
	if err != nil {
		return "", fmt.Errorf("resolve CA certificate path %q: %w", configuredPath, err)
	}
	if !pathWithinRoot(rootPath, candidatePath) {
		return "", fmt.Errorf("CA certificate path %q escapes the application root", configuredPath)
	}

	resolvedRoot, err := filepath.EvalSymlinks(rootPath)
	if err != nil {
		return "", fmt.Errorf("resolve application root links: %w", err)
	}
	resolvedCandidate, err := filepath.EvalSymlinks(candidatePath)
	if err != nil {
		return "", fmt.Errorf("resolve CA certificate links %q: %w", configuredPath, err)
	}
	if !pathWithinRoot(resolvedRoot, resolvedCandidate) {
		return "", fmt.Errorf("CA certificate path %q resolves outside the application root", configuredPath)
	}
	return resolvedCandidate, nil
}

func pathWithinRoot(rootPath, candidatePath string) bool {
	relativePath, err := filepath.Rel(rootPath, candidatePath)
	if err != nil {
		return false
	}
	return relativePath != ".." && !strings.HasPrefix(relativePath, ".."+string(filepath.Separator))
}

func buildAllowedAuthorities(configuredHosts []string) (map[string]struct{}, error) {
	allowed := make(map[string]struct{}, len(configuredHosts))
	for _, configuredHost := range configuredHosts {
		authority, err := normalizeConfiguredAuthority(configuredHost)
		if err != nil {
			return nil, err
		}
		allowed[authority] = struct{}{}
	}
	return allowed, nil
}

func normalizeConfiguredAuthority(configuredHost string) (string, error) {
	value := strings.TrimSpace(configuredHost)
	if value == "" {
		return "", fmt.Errorf("allowed SMDP+ host must not be empty")
	}
	if !strings.Contains(value, "://") {
		value = "https://" + value
	}

	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("invalid allowed SMDP+ host %q: %w", configuredHost, err)
	}
	if !strings.EqualFold(parsed.Scheme, "https") || parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("allowed SMDP+ host %q must be an HTTPS host or host:port without credentials, path, query, or fragment", configuredHost)
	}
	return canonicalHTTPSAuthority(parsed)
}

func canonicalHTTPSAuthority(parsed *url.URL) (string, error) {
	if parsed == nil || !strings.EqualFold(parsed.Scheme, "https") || parsed.User != nil {
		return "", fmt.Errorf("target must be an HTTPS URL without credentials")
	}
	if strings.HasSuffix(parsed.Host, ":") {
		return "", fmt.Errorf("target port must not be empty")
	}
	hostname := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(parsed.Hostname())), ".")
	if hostname == "" {
		return "", fmt.Errorf("target host must not be empty")
	}

	port := parsed.Port()
	if port == "" || port == "443" {
		return hostname, nil
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return "", fmt.Errorf("target port %q is invalid", port)
	}
	return net.JoinHostPort(hostname, port), nil
}

func (h *httpsRelay) targetAllowed(targetURL string) bool {
	parsed, err := url.Parse(targetURL)
	if err != nil {
		return false
	}
	authority, err := canonicalHTTPSAuthority(parsed)
	if err != nil {
		return false
	}
	_, ok := h.allowedAuthorities[authority]
	return ok
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
	if parsed.User != nil {
		return "", fmt.Errorf("url must not contain credentials")
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

	value := address
	if !strings.Contains(value, "://") {
		value = "https://" + value
	}

	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("smdpAddress format error: %w", err)
	}
	if !strings.EqualFold(parsed.Scheme, "https") || parsed.Host == "" || parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("smdpAddress must be an HTTPS host or host:port without credentials, path, query, or fragment")
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

	if strings.TrimSpace(payload.SMDPAddress) == "" {
		return "", fmt.Errorf("相对 URL 需要 body.smdpAddress")
	}
	return normalizeSMDPHost(payload.SMDPAddress)
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
