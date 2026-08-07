package framework

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultEsimHTTPSRelayConfigFailsClosed(t *testing.T) {
	config := LoadAppConfig(t.TempDir())

	if len(config.EsimHTTPSRelay.AllowedHosts) != 0 {
		t.Fatalf("default allowedHosts = %#v, want empty", config.EsimHTTPSRelay.AllowedHosts)
	}
	if len(config.EsimHTTPSRelay.CACertFiles) != 0 {
		t.Fatalf("default caCertFiles = %#v, want empty", config.EsimHTTPSRelay.CACertFiles)
	}
	if config.EsimHTTPSRelay.MaxRequestBodyBytes != defaultEsimHTTPSRelayMaxRequestBodyBytes {
		t.Fatalf("default maxRequestBodyBytes = %d, want %d", config.EsimHTTPSRelay.MaxRequestBodyBytes, defaultEsimHTTPSRelayMaxRequestBodyBytes)
	}
}

func TestLoadAppConfigReadsEsimHTTPSRelayPolicy(t *testing.T) {
	rootDir := t.TempDir()
	configJSON := `{
  "esimHttpsRelay": {
    "allowedHosts": ["smdp.example.com", "smdp-backup.example.com:8443"],
    "caCertFiles": ["certs/company-ca.pem"],
    "maxRequestBodyBytes": 2048
  }
}`
	if err := os.WriteFile(filepath.Join(rootDir, appConfigFileName), []byte(configJSON), 0o600); err != nil {
		t.Fatalf("write app config: %v", err)
	}

	config := LoadAppConfig(rootDir)
	if len(config.EsimHTTPSRelay.AllowedHosts) != 2 || config.EsimHTTPSRelay.AllowedHosts[1] != "smdp-backup.example.com:8443" {
		t.Fatalf("allowedHosts = %#v", config.EsimHTTPSRelay.AllowedHosts)
	}
	if len(config.EsimHTTPSRelay.CACertFiles) != 1 || config.EsimHTTPSRelay.CACertFiles[0] != "certs/company-ca.pem" {
		t.Fatalf("caCertFiles = %#v", config.EsimHTTPSRelay.CACertFiles)
	}
	if config.EsimHTTPSRelay.MaxRequestBodyBytes != 2048 {
		t.Fatalf("maxRequestBodyBytes = %d, want 2048", config.EsimHTTPSRelay.MaxRequestBodyBytes)
	}
	if config.RootDir != rootDir {
		t.Fatalf("rootDir = %q, want %q", config.RootDir, rootDir)
	}
}

func TestNegativeEsimHTTPSRelayLimitIsNotSilentlyDefaulted(t *testing.T) {
	config := normalizeAppConfig(AppConfig{
		RootDir: t.TempDir(),
		EsimHTTPSRelay: EsimHTTPSRelayConfig{
			MaxRequestBodyBytes: -1,
		},
	})
	if config.EsimHTTPSRelay.MaxRequestBodyBytes != -1 {
		t.Fatalf("negative maxRequestBodyBytes = %d, want -1", config.EsimHTTPSRelay.MaxRequestBodyBytes)
	}
}
