package nmea

import (
	"math"
	"strings"
	"testing"
)

func TestReplayPlayerParsesFramesAndCoordinates(t *testing.T) {
	content := strings.Join([]string{
		"$GNRMC,120000.000,A,3954.25200,N,11624.44400,E,0.000,0.000,010126,,,A,S*00",
		"$GPGGA,120000,3954.2520,N,11624.4440,E,1,12,1.0,50.0,M,0.0,M,,*00",
		"$GNRMC,120001.000,A,2232.53680,N,11356.55960,E,1.500,90.000,010126,,,A,S*00",
	}, "\n")

	player := NewReplayPlayer()
	if err := player.Load("sample.nmea", strings.NewReader(content)); err != nil {
		t.Fatalf("load replay: %v", err)
	}
	if player.Count() != 2 {
		t.Fatalf("expected 2 frames, got %d", player.Count())
	}

	record := player.CurrentRecord()
	if record == nil {
		t.Fatal("expected current record")
	}
	assertNear(t, record.Latitude, 39.9042)
	assertNear(t, record.Longitude, 116.4074)
	if record.Altitude != 50 {
		t.Fatalf("expected altitude 50, got %f", record.Altitude)
	}
}

func assertNear(t *testing.T, actual, expected float64) {
	t.Helper()
	if math.Abs(actual-expected) > 0.00001 {
		t.Fatalf("expected %.6f, got %.6f", expected, actual)
	}
}
