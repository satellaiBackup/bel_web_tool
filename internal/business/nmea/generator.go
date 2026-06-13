package nmea

import (
	"fmt"
	"math"
	"strings"
	"time"
)

type SentenceGenerator struct {
	Latitude   float64
	Longitude  float64
	Altitude   float64
	Speed      float64
	Course     float64
	Satellites int
}

func NewSentenceGenerator(settings GeneratorSettings) *SentenceGenerator {
	return &SentenceGenerator{
		Latitude:   settings.Latitude,
		Longitude:  settings.Longitude,
		Altitude:   settings.Altitude,
		Speed:      settings.Speed,
		Course:     settings.Course,
		Satellites: settings.Satellites,
	}
}

func (g *SentenceGenerator) GenerateGGA(timestamp time.Time) string {
	utcTime := timestamp.UTC().Format("150405")
	latDir, latValue := convertCoordinate(g.Latitude, false)
	lonDir, lonValue := convertCoordinate(g.Longitude, true)

	data := fmt.Sprintf("GPGGA,%s,%.4f,%s,%.4f,%s,1,%02d,1.0,%.1f,M,0.0,M,,",
		utcTime, latValue, latDir, lonValue, lonDir, g.Satellites, g.Altitude)

	return withChecksum(data)
}

func (g *SentenceGenerator) GenerateRMC(timestamp time.Time) string {
	utcTime := timestamp.UTC().Format("150405.000")
	utcDate := timestamp.UTC().Format("020106")
	latDir, latValue := convertCoordinate(g.Latitude, false)
	lonDir, lonValue := convertCoordinate(g.Longitude, true)

	data := fmt.Sprintf("GNRMC,%s,A,%.5f,%s,%.5f,%s,%.3f,%.3f,%s,,,A,S",
		utcTime, latValue, latDir, lonValue, lonDir, g.Speed, g.Course, utcDate)

	return withChecksum(data)
}

func (g *SentenceGenerator) GenerateGSA() string {
	gpsSatellites := g.Satellites / 2
	if gpsSatellites > 12 {
		gpsSatellites = 12
	}

	data := "GPGSA,A,3"
	for i := 1; i <= gpsSatellites; i++ {
		data += fmt.Sprintf(",%02d", i)
	}
	for i := gpsSatellites; i < 12; i++ {
		data += ","
	}
	data += ",1.0,1.0,1.0"

	return withChecksum(data)
}

func (g *SentenceGenerator) GenerateGSV() []string {
	const satellitesPerMessage = 4

	gpsSatellites := g.Satellites / 2
	beidouSatellites := g.Satellites - gpsSatellites
	systems := []struct {
		prefix      string
		signalID    int
		satellites  int
		satIDOffset int
	}{
		{prefix: "GPGSV", signalID: 1, satellites: gpsSatellites, satIDOffset: 0},
		{prefix: "GBGSV", signalID: 1, satellites: beidouSatellites, satIDOffset: 200},
	}

	var messages []string
	for _, system := range systems {
		if system.satellites == 0 {
			continue
		}

		totalMessages := (system.satellites + satellitesPerMessage - 1) / satellitesPerMessage
		for messageNumber := 1; messageNumber <= totalMessages; messageNumber++ {
			startSatellite := (messageNumber-1)*satellitesPerMessage + 1
			endSatellite := messageNumber * satellitesPerMessage
			if endSatellite > system.satellites {
				endSatellite = system.satellites
			}

			data := fmt.Sprintf("%s,%d,%02d,%d", system.prefix, totalMessages, messageNumber, system.satellites)
			for satelliteID := startSatellite; satelliteID <= endSatellite; satelliteID++ {
				actualSatelliteID := satelliteID + system.satIDOffset
				elevation := 45 + (satelliteID%3)*15
				azimuth := (satelliteID - 1) * 30 % 360
				snr := 35 + (satelliteID % 10)
				data += fmt.Sprintf(",%02d,%02d,%03d,%d", actualSatelliteID, elevation, azimuth, snr)
			}

			for i := endSatellite - startSatellite + 1; i < satellitesPerMessage; i++ {
				data += ",,,,"
			}
			data += fmt.Sprintf(",%d", system.signalID)
			messages = append(messages, withChecksum(data))
		}
	}

	return messages
}

func (g *SentenceGenerator) GenerateVTG() string {
	speedKmh := g.Speed * 1.852
	data := fmt.Sprintf("GPVTG,%.1f,T,%.1f,M,%.1f,N,%.1f,K",
		g.Course, g.Course, g.Speed, speedKmh)

	return withChecksum(data)
}

func (g *SentenceGenerator) GenerateGST(timestamp time.Time) string {
	utcTime := timestamp.UTC().Format("150405.000")
	data := fmt.Sprintf("GPGST,%s,1.2,1.5,0.8,45.0,1.0,1.2,2.0", utcTime)

	return withChecksum(data)
}

func (g *SentenceGenerator) GenerateGLL(timestamp time.Time) string {
	utcTime := timestamp.UTC().Format("150405.000")
	latDir, latValue := convertCoordinate(g.Latitude, false)
	lonDir, lonValue := convertCoordinate(g.Longitude, true)

	data := fmt.Sprintf("GPGLL,%.5f,%s,%.5f,%s,%s,A,A",
		latValue, latDir, lonValue, lonDir, utcTime)

	return withChecksum(data)
}

func (g *SentenceGenerator) GenerateOrderedSet(timestamp time.Time, order []string, enabled map[string]bool) []string {
	var sentences []string
	for _, sentenceType := range order {
		if enabled != nil && !enabled[sentenceType] {
			continue
		}

		switch sentenceType {
		case "GGA":
			sentences = append(sentences, g.GenerateGGA(timestamp))
		case "RMC":
			sentences = append(sentences, g.GenerateRMC(timestamp))
		case "GSA":
			sentences = append(sentences, g.GenerateGSA())
		case "GSV":
			sentences = append(sentences, g.GenerateGSV()...)
		case "VTG":
			sentences = append(sentences, g.GenerateVTG())
		case "GST":
			sentences = append(sentences, g.GenerateGST(timestamp))
		case "GLL":
			sentences = append(sentences, g.GenerateGLL(timestamp))
		}
	}

	return sentences
}

func convertCoordinate(value float64, longitude bool) (string, float64) {
	absValue := math.Abs(value)
	degrees := int(absValue)
	minutes := (absValue - float64(degrees)) * 60

	direction := "N"
	if longitude {
		direction = "E"
	}
	if value < 0 {
		if longitude {
			direction = "W"
		} else {
			direction = "S"
		}
	}

	return direction, float64(degrees*100) + minutes
}

func withChecksum(data string) string {
	return fmt.Sprintf("$%s*%02X\r\n", data, calculateChecksum(data))
}

func calculateChecksum(data string) byte {
	var checksum byte
	for i := 0; i < len(data); i++ {
		checksum ^= data[i]
	}
	return checksum
}

func stripNMEALineEnding(line string) string {
	return strings.TrimRight(line, "\r\n")
}
