package esim

import (
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestResolveTargetURLWithRelativePath(t *testing.T) {
	got, err := resolveTargetURL(
		"/gsma/rsp2/es9plus/initiateAuthentication",
		`{"smdpAddress":"secsmsminiapp.eastcompeace.com"}`,
		"",
	)
	if err != nil {
		t.Fatalf("resolveTargetURL returned error: %v", err)
	}

	want := "https://secsmsminiapp.eastcompeace.com/gsma/rsp2/es9plus/initiateAuthentication"
	if got != want {
		t.Fatalf("resolveTargetURL = %q, want %q", got, want)
	}
}

func TestResolveTargetURLUsesFallbackSMDPAddress(t *testing.T) {
	got, err := resolveTargetURL(
		"/gsma/rsp2/es9plus/authenticateClient",
		`{"transactionId":"x"}`,
		"secsmsminiapp.eastcompeace.com",
	)
	if err != nil {
		t.Fatalf("resolveTargetURL returned error: %v", err)
	}

	want := "https://secsmsminiapp.eastcompeace.com/gsma/rsp2/es9plus/authenticateClient"
	if got != want {
		t.Fatalf("resolveTargetURL = %q, want %q", got, want)
	}
}

func TestResolveTargetURLKeepsAbsoluteHTTPS(t *testing.T) {
	got, err := resolveTargetURL(
		"https://example.com/gsma/rsp2/es9plus/authenticateClient?x=1",
		`{}`,
		"secsmsminiapp.eastcompeace.com",
	)
	if err != nil {
		t.Fatalf("resolveTargetURL returned error: %v", err)
	}

	want := "https://example.com/gsma/rsp2/es9plus/authenticateClient?x=1"
	if got != want {
		t.Fatalf("resolveTargetURL = %q, want %q", got, want)
	}
}

func TestResolveTargetURLRejectsSMDPAddressWithPath(t *testing.T) {
	_, err := resolveTargetURL(
		"/gsma/rsp2/es9plus/initiateAuthentication",
		`{"smdpAddress":"https://example.com/unexpected-path"}`,
		"",
	)
	if err == nil {
		t.Fatal("smdpAddress with path must be rejected")
	}
}

func TestHTTPSRelayDeniesTargetsByDefault(t *testing.T) {
	relay, err := newHTTPSRelay(HTTPSRelayConfig{
		MaxRequestBodyBytes: 1024,
		RootDir:             t.TempDir(),
	})
	if err != nil {
		t.Fatalf("newHTTPSRelay returned error: %v", err)
	}

	response := performHTTPSRelayRequest(t, relay, httpsRelayRequest{URL: "https://example.com/status"})
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
	}
}

func TestHTTPSRelayRejectsOversizedRequestBody(t *testing.T) {
	const limit = int64(96)
	relay, err := newHTTPSRelay(HTTPSRelayConfig{
		AllowedHosts:        []string{"example.com"},
		MaxRequestBodyBytes: limit,
		RootDir:             t.TempDir(),
	})
	if err != nil {
		t.Fatalf("newHTTPSRelay returned error: %v", err)
	}

	body := `{"url":"https://example.com","body":"` + strings.Repeat("x", int(limit)) + `"}`
	request := httptest.NewRequest(http.MethodPost, "/api/esim/https", strings.NewReader(body))
	response := httptest.NewRecorder()
	relay.handleHTTPSRelay(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusRequestEntityTooLarge, response.Body.String())
	}
}

func TestHTTPSRelayVerifiesTLSAndSupportsControlledCA(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"trusted":true}`))
	}))
	defer server.Close()

	serverURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}
	rootDir := t.TempDir()
	baseConfig := HTTPSRelayConfig{
		AllowedHosts:        []string{serverURL.Host},
		MaxRequestBodyBytes: 1024,
		RootDir:             rootDir,
	}

	untrustedRelay, err := newHTTPSRelay(baseConfig)
	if err != nil {
		t.Fatalf("newHTTPSRelay without CA returned error: %v", err)
	}
	untrustedResponse := performHTTPSRelayRequest(t, untrustedRelay, httpsRelayRequest{URL: server.URL})
	if untrustedResponse.Code != http.StatusBadGateway {
		t.Fatalf("untrusted status = %d, want %d; body=%s", untrustedResponse.Code, http.StatusBadGateway, untrustedResponse.Body.String())
	}

	certDir := filepath.Join(rootDir, "certs")
	if err := os.Mkdir(certDir, 0o700); err != nil {
		t.Fatalf("create certificate directory: %v", err)
	}
	certPath := filepath.Join(certDir, "test-ca.pem")
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})
	if err := os.WriteFile(certPath, certPEM, 0o600); err != nil {
		t.Fatalf("write test CA: %v", err)
	}

	baseConfig.CACertFiles = []string{filepath.Join("certs", "test-ca.pem")}
	trustedRelay, err := newHTTPSRelay(baseConfig)
	if err != nil {
		t.Fatalf("newHTTPSRelay with CA returned error: %v", err)
	}
	trustedResponse := performHTTPSRelayRequest(t, trustedRelay, httpsRelayRequest{URL: server.URL})
	if trustedResponse.Code != http.StatusOK {
		t.Fatalf("trusted status = %d, want %d; body=%s", trustedResponse.Code, http.StatusOK, trustedResponse.Body.String())
	}
	if !strings.Contains(trustedResponse.Body.String(), `{"trusted":true}`) {
		t.Fatalf("trusted response missing upstream body: %s", trustedResponse.Body.String())
	}
}

func TestHTTPSRelayRejectsRedirectOutsideAllowedTargets(t *testing.T) {
	var redirectedTargetHit atomic.Bool
	redirectedTarget := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		redirectedTargetHit.Store(true)
		w.WriteHeader(http.StatusOK)
	}))
	defer redirectedTarget.Close()

	allowedTarget := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, redirectedTarget.URL, http.StatusFound)
	}))
	defer allowedTarget.Close()
	allowedURL, err := url.Parse(allowedTarget.URL)
	if err != nil {
		t.Fatalf("parse allowed test server URL: %v", err)
	}

	rootDir := t.TempDir()
	certPath := filepath.Join(rootDir, "allowed-ca.pem")
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: allowedTarget.Certificate().Raw})
	if err := os.WriteFile(certPath, certPEM, 0o600); err != nil {
		t.Fatalf("write allowed test CA: %v", err)
	}
	relay, err := newHTTPSRelay(HTTPSRelayConfig{
		AllowedHosts:        []string{allowedURL.Host},
		CACertFiles:         []string{"allowed-ca.pem"},
		MaxRequestBodyBytes: 1024,
		RootDir:             rootDir,
	})
	if err != nil {
		t.Fatalf("newHTTPSRelay returned error: %v", err)
	}

	response := performHTTPSRelayRequest(t, relay, httpsRelayRequest{URL: allowedTarget.URL})
	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusBadGateway, response.Body.String())
	}
	if redirectedTargetHit.Load() {
		t.Fatal("relay followed redirect to a target outside the allow policy")
	}
}

func TestHTTPSRelayRejectsInvalidSecurityConfiguration(t *testing.T) {
	tests := []struct {
		name   string
		config HTTPSRelayConfig
	}{
		{
			name: "non-HTTPS allow entry",
			config: HTTPSRelayConfig{
				AllowedHosts:        []string{"http://example.com"},
				MaxRequestBodyBytes: 1024,
				RootDir:             t.TempDir(),
			},
		},
		{
			name: "CA path escapes root",
			config: HTTPSRelayConfig{
				CACertFiles:         []string{"../ca.pem"},
				MaxRequestBodyBytes: 1024,
				RootDir:             t.TempDir(),
			},
		},
		{
			name: "empty target port",
			config: HTTPSRelayConfig{
				AllowedHosts:        []string{"example.com:"},
				MaxRequestBodyBytes: 1024,
				RootDir:             t.TempDir(),
			},
		},
		{
			name: "negative request limit",
			config: HTTPSRelayConfig{
				MaxRequestBodyBytes: -1,
				RootDir:             t.TempDir(),
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := newHTTPSRelay(test.config); err == nil {
				t.Fatal("invalid security configuration must fail")
			}
		})
	}
}

func TestApplyGSMAHTTPSHeadersForPost(t *testing.T) {
	body := `{"transactionId":"x"}`
	req, err := http.NewRequest(
		http.MethodPost,
		"https://demo-consumer.validspereachdpplus.com/gsma/rsp2/es9plus/authenticateClient",
		strings.NewReader(body),
	)
	if err != nil {
		t.Fatalf("NewRequest returned error: %v", err)
	}

	applyGSMAHTTPSHeaders(req)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("charset", "utf-8")

	assertHeader(t, req, "X-Admin-Protocol", "gsma/rsp/v2.2.0")
	assertHeader(t, req, "Content-Type", "application/json")
	assertHeader(t, req, "charset", "utf-8")
	assertHeader(t, req, "User-Agent", "gsma-rsp-lpad")
	if req.Host != "demo-consumer.validspereachdpplus.com:443" {
		t.Fatalf("Host = %q, want %q", req.Host, "demo-consumer.validspereachdpplus.com:443")
	}
	if req.ContentLength != int64(len(body)) {
		t.Fatalf("ContentLength = %d, want %d", req.ContentLength, len(body))
	}
}

func TestSerializeHTTPSResponseIncludesStatusHeadersAndBody(t *testing.T) {
	resp := &http.Response{
		Status:        "202 Accepted",
		StatusCode:    http.StatusAccepted,
		Proto:         "HTTP/1.1",
		ProtoMajor:    1,
		ProtoMinor:    1,
		Header:        make(http.Header),
		Body:          io.NopCloser(strings.NewReader("ignored")),
		ContentLength: -1,
	}
	resp.Header.Set("Content-Type", "application/json")
	resp.Header.Set("X-Test", "ok")

	got, err := serializeHTTPSResponse(resp, []byte(`{"ok":true}`))
	if err != nil {
		t.Fatalf("serializeHTTPSResponse returned error: %v", err)
	}
	text := string(got)
	for _, want := range []string{
		"HTTP/1.1 202 Accepted\r\n",
		"Content-Type: application/json\r\n",
		"X-Test: ok\r\n",
		"Content-Length: 11\r\n",
		"\r\n{\"ok\":true}",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("serialized response does not contain %q; got:\n%s", want, text)
		}
	}
}

func assertHeader(t *testing.T, req *http.Request, key, want string) {
	t.Helper()
	if got := req.Header.Get(key); got != want {
		t.Fatalf("%s = %q, want %q", key, got, want)
	}
}

func performHTTPSRelayRequest(t *testing.T, relay *httpsRelay, payload httpsRelayRequest) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal relay request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/esim/https", strings.NewReader(string(body)))
	response := httptest.NewRecorder()
	relay.handleHTTPSRelay(response, request)
	return response
}
