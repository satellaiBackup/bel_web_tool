package esim

import (
	"net/http"
	"strings"
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

func assertHeader(t *testing.T, req *http.Request, key, want string) {
	t.Helper()
	if got := req.Header.Get(key); got != want {
		t.Fatalf("%s = %q, want %q", key, got, want)
	}
}
