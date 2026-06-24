package esim

import "testing"

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
