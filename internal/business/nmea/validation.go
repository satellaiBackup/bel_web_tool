package nmea

import (
	"errors"
	"fmt"
)

func normalizeToolConfig(config ToolConfig) (ToolConfig, error) {
	serialConfig, err := normalizeSerialConfig(config.Serial, false)
	if err != nil {
		return ToolConfig{}, err
	}

	generatorSettings, err := normalizeGeneratorSettings(config.Generator)
	if err != nil {
		return ToolConfig{}, err
	}

	replaySettings, err := normalizeReplaySettings(config.Replay)
	if err != nil {
		return ToolConfig{}, err
	}

	return ToolConfig{
		Serial:    serialConfig,
		Generator: generatorSettings,
		Replay:    replaySettings,
	}, nil
}

func normalizeSerialConfig(config SerialConfig, requirePort bool) (SerialConfig, error) {
	if config.BaudRate == 0 {
		config.BaudRate = defaultBaudRate
	}
	if config.DataBits == 0 {
		config.DataBits = defaultDataBits
	}
	if requirePort && config.PortName == "" {
		return SerialConfig{}, errors.New("串口不能为空")
	}
	if config.BaudRate <= 0 {
		return SerialConfig{}, errors.New("波特率必须大于 0")
	}
	if config.DataBits < 5 || config.DataBits > 8 {
		return SerialConfig{}, errors.New("数据位必须在 5 到 8 之间")
	}
	if config.StopBits < 0 || config.StopBits > 2 {
		return SerialConfig{}, errors.New("停止位无效")
	}
	if config.Parity < 0 || config.Parity > 4 {
		return SerialConfig{}, errors.New("校验位无效")
	}
	return config, nil
}

func normalizeGeneratorSettings(settings GeneratorSettings) (GeneratorSettings, error) {
	if settings.Latitude < -90 || settings.Latitude > 90 {
		return GeneratorSettings{}, errors.New("纬度必须在 -90 到 90 之间")
	}
	if settings.Longitude < -180 || settings.Longitude > 180 {
		return GeneratorSettings{}, errors.New("经度必须在 -180 到 180 之间")
	}
	if settings.Satellites < 0 || settings.Satellites > 32 {
		return GeneratorSettings{}, errors.New("卫星数量必须在 0 到 32 之间")
	}
	if settings.SendIntervalMs == 0 {
		settings.SendIntervalMs = defaultSendIntervalMs
	}
	if settings.SendIntervalMs < 100 {
		return GeneratorSettings{}, errors.New("发送间隔不能小于 100 毫秒")
	}
	if len(settings.SentenceOrder) == 0 {
		settings.SentenceOrder = append([]string(nil), supportedSentenceTypes...)
	}
	if settings.SentenceEnabled == nil {
		settings.SentenceEnabled = make(map[string]bool, len(supportedSentenceTypes))
		for _, sentenceType := range supportedSentenceTypes {
			settings.SentenceEnabled[sentenceType] = true
		}
	}

	known := make(map[string]bool, len(supportedSentenceTypes))
	for _, sentenceType := range supportedSentenceTypes {
		known[sentenceType] = true
		if _, ok := settings.SentenceEnabled[sentenceType]; !ok {
			settings.SentenceEnabled[sentenceType] = false
		}
	}

	seen := make(map[string]bool, len(settings.SentenceOrder))
	normalizedOrder := make([]string, 0, len(settings.SentenceOrder))
	for _, sentenceType := range settings.SentenceOrder {
		if !known[sentenceType] {
			return GeneratorSettings{}, fmt.Errorf("不支持的 NMEA 语句: %s", sentenceType)
		}
		if seen[sentenceType] {
			continue
		}
		seen[sentenceType] = true
		normalizedOrder = append(normalizedOrder, sentenceType)
	}
	for _, sentenceType := range supportedSentenceTypes {
		if !seen[sentenceType] {
			normalizedOrder = append(normalizedOrder, sentenceType)
		}
	}
	settings.SentenceOrder = normalizedOrder

	for sentenceType := range settings.SentenceEnabled {
		if !known[sentenceType] {
			return GeneratorSettings{}, fmt.Errorf("不支持的 NMEA 语句: %s", sentenceType)
		}
	}

	return cloneGeneratorSettings(settings), nil
}

func normalizeReplaySettings(settings ReplaySettings) (ReplaySettings, error) {
	if settings.ReplaySpeed == 0 {
		settings.ReplaySpeed = defaultReplaySpeed
	}
	if settings.ReplaySpeed <= 0 {
		return ReplaySettings{}, errors.New("回放速度必须大于 0")
	}
	if settings.ReplaySpeed > 20 {
		return ReplaySettings{}, errors.New("回放速度不能大于 20 倍")
	}
	return settings, nil
}
