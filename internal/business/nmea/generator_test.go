package nmea

import (
	"strings"
	"testing"
	"time"
)

func TestGenerateGGACoordinatesAndChecksum(t *testing.T) {
	settings := defaultConfig().Generator
	settings.Latitude = 39.9042
	settings.Longitude = 116.4074
	settings.Altitude = 50
	settings.Satellites = 12

	line := NewSentenceGenerator(settings).GenerateGGA(time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC))
	expectedPrefix := "$GPGGA,030405,3954.2520,N,11624.4440,E,1,12,1.0,50.0,M,0.0,M,,"
	if !strings.HasPrefix(line, expectedPrefix) {
		t.Fatalf("unexpected GGA line:\n%s", line)
	}
	if !hasValidChecksum(line) {
		t.Fatalf("invalid checksum: %s", line)
	}
}

func hasValidChecksum(line string) bool {
	line = stripNMEALineEnding(line)
	star := strings.LastIndex(line, "*")
	if !strings.HasPrefix(line, "$") || star < 0 {
		return false
	}
	data := line[1:star]
	return strings.EqualFold(line[star+1:], strings.ToUpper(hexByte(calculateChecksum(data))))
}

func hexByte(value byte) string {
	const digits = "0123456789ABCDEF"
	return string([]byte{digits[value>>4], digits[value&0x0f]})
}
