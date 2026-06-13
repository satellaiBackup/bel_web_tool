package nmea

import "time"

const (
	defaultBaudRate       = 115200
	defaultDataBits       = 8
	defaultSendIntervalMs = 1000
	defaultReplaySpeed    = 1.0
)

var supportedSentenceTypes = []string{"GGA", "RMC", "GSA", "GSV", "VTG", "GST", "GLL"}

type ToolConfig struct {
	Serial    SerialConfig      `json:"serial"`
	Generator GeneratorSettings `json:"generator"`
	Replay    ReplaySettings    `json:"replay"`
}

type SerialConfig struct {
	PortName string `json:"portName"`
	BaudRate int    `json:"baudRate"`
	DataBits int    `json:"dataBits"`
	StopBits int    `json:"stopBits"`
	Parity   int    `json:"parity"`
}

type SerialStatus struct {
	Open     bool   `json:"open"`
	PortName string `json:"portName"`
	BaudRate int    `json:"baudRate"`
	DataBits int    `json:"dataBits"`
	StopBits int    `json:"stopBits"`
	Parity   int    `json:"parity"`
}

type GeneratorSettings struct {
	Latitude        float64         `json:"latitude"`
	Longitude       float64         `json:"longitude"`
	Altitude        float64         `json:"altitude"`
	Speed           float64         `json:"speed"`
	Course          float64         `json:"course"`
	Satellites      int             `json:"satellites"`
	SendIntervalMs  int             `json:"sendIntervalMs"`
	SentenceOrder   []string        `json:"sentenceOrder"`
	SentenceEnabled map[string]bool `json:"sentenceEnabled"`
}

type ReplaySettings struct {
	ReplaySpeed     float64 `json:"replaySpeed"`
	LoopPlayback    bool    `json:"loopPlayback"`
	UpdateTimestamp bool    `json:"updateTimestamp"`
}

type RuntimeStatus struct {
	Running   bool   `json:"running"`
	Mode      string `json:"mode"`
	StartedAt string `json:"startedAt,omitempty"`
}

type ReplayStatus struct {
	Loaded        bool        `json:"loaded"`
	FileName      string      `json:"fileName,omitempty"`
	RecordCount   int         `json:"recordCount"`
	CurrentIndex  int         `json:"currentIndex"`
	CurrentRecord *NMEARecord `json:"currentRecord,omitempty"`
}

type ToolState struct {
	Config        ToolConfig    `json:"config"`
	Serial        SerialStatus  `json:"serial"`
	Runtime       RuntimeStatus `json:"runtime"`
	Replay        ReplayStatus  `json:"replay"`
	LastGenerated []string      `json:"lastGenerated"`
}

func defaultConfig() ToolConfig {
	return ToolConfig{
		Serial: SerialConfig{
			BaudRate: defaultBaudRate,
			DataBits: defaultDataBits,
			StopBits: 0,
			Parity:   0,
		},
		Generator: GeneratorSettings{
			Latitude:       39.9042,
			Longitude:      116.4074,
			Altitude:       50,
			Speed:          0,
			Course:         0,
			Satellites:     22,
			SendIntervalMs: defaultSendIntervalMs,
			SentenceOrder:  append([]string(nil), supportedSentenceTypes...),
			SentenceEnabled: map[string]bool{
				"GGA": true,
				"RMC": true,
				"GSA": true,
				"GSV": true,
				"VTG": true,
				"GST": true,
				"GLL": true,
			},
		},
		Replay: ReplaySettings{
			ReplaySpeed:     defaultReplaySpeed,
			LoopPlayback:    false,
			UpdateTimestamp: true,
		},
	}
}

func cloneConfig(config ToolConfig) ToolConfig {
	config.Generator.SentenceOrder = append([]string(nil), config.Generator.SentenceOrder...)
	config.Generator.SentenceEnabled = cloneBoolMap(config.Generator.SentenceEnabled)
	return config
}

func cloneGeneratorSettings(settings GeneratorSettings) GeneratorSettings {
	settings.SentenceOrder = append([]string(nil), settings.SentenceOrder...)
	settings.SentenceEnabled = cloneBoolMap(settings.SentenceEnabled)
	return settings
}

func cloneBoolMap(input map[string]bool) map[string]bool {
	if input == nil {
		return nil
	}
	output := make(map[string]bool, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func runtimeStatus(running bool, mode string, startedAt time.Time) RuntimeStatus {
	status := RuntimeStatus{
		Running: running,
		Mode:    mode,
	}
	if !startedAt.IsZero() {
		status.StartedAt = startedAt.Format(time.RFC3339Nano)
	}
	return status
}
