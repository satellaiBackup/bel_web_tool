package nmea

import (
	"context"
	"strings"
	"sync"
	"time"
)

type Manager struct {
	mu     sync.Mutex
	serial *SerialDevice
	player *ReplayPlayer
	config ToolConfig

	cancelRun context.CancelFunc
	runID     int
	mode      string
	startedAt time.Time

	lastGenerated []string
}

func NewManager() *Manager {
	config, err := normalizeToolConfig(defaultConfig())
	if err != nil {
		config = defaultConfig()
	}

	return &Manager{
		serial: NewSerialDevice(config.Serial),
		player: NewReplayPlayer(),
		config: config,
	}
}

func (m *Manager) State() ToolState {
	m.mu.Lock()
	config := cloneConfig(m.config)
	running := m.cancelRun != nil
	mode := m.mode
	startedAt := m.startedAt
	lastGenerated := append([]string(nil), m.lastGenerated...)
	replayState := m.player.State()
	m.mu.Unlock()

	return ToolState{
		Config:        config,
		Serial:        m.serial.Status(),
		Runtime:       runtimeStatus(running, mode, startedAt),
		Replay:        replayState,
		LastGenerated: lastGenerated,
	}
}

func (m *Manager) UpdateConfig(config ToolConfig) (ToolState, error) {
	normalized, err := normalizeToolConfig(config)
	if err != nil {
		return ToolState{}, err
	}

	m.mu.Lock()
	m.config = normalized
	m.mu.Unlock()

	return m.State(), nil
}

func (m *Manager) OpenSerial(config SerialConfig) (ToolState, error) {
	normalized, err := normalizeSerialConfig(config, true)
	if err != nil {
		return ToolState{}, err
	}
	if err := m.serial.Open(normalized); err != nil {
		return ToolState{}, err
	}

	m.mu.Lock()
	m.config.Serial = normalized
	m.mu.Unlock()

	return m.State(), nil
}

func (m *Manager) CloseSerial() (ToolState, error) {
	m.Stop()
	if err := m.serial.Close(); err != nil {
		return ToolState{}, err
	}
	return m.State(), nil
}

func (m *Manager) Generate(settings GeneratorSettings) ([]string, ToolState, error) {
	normalized, err := normalizeGeneratorSettings(settings)
	if err != nil {
		return nil, ToolState{}, err
	}

	lines := generateLines(normalized, time.Now())

	m.mu.Lock()
	m.config.Generator = normalized
	m.lastGenerated = append([]string(nil), lines...)
	m.mu.Unlock()

	return lines, m.State(), nil
}

func (m *Manager) StartGenerate(settings GeneratorSettings) (ToolState, error) {
	normalized, err := normalizeGeneratorSettings(settings)
	if err != nil {
		return ToolState{}, err
	}
	if !m.serial.Status().Open {
		return ToolState{}, errSerialNotOpen()
	}

	m.Stop()

	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	m.runID++
	runID := m.runID
	m.cancelRun = cancel
	m.mode = "generate"
	m.startedAt = time.Now()
	m.config.Generator = normalized
	m.mu.Unlock()

	go m.generateLoop(ctx, runID)
	return m.State(), nil
}

func (m *Manager) Stop() bool {
	m.mu.Lock()
	cancel := m.cancelRun
	m.cancelRun = nil
	m.mode = ""
	m.startedAt = time.Time{}
	m.mu.Unlock()

	if cancel != nil {
		cancel()
		return true
	}
	return false
}

func (m *Manager) LoadReplay(fileName, content string) (ToolState, error) {
	player := NewReplayPlayer()
	if err := player.Load(fileName, strings.NewReader(content)); err != nil {
		return ToolState{}, err
	}

	m.mu.Lock()
	m.player = player
	m.mu.Unlock()

	return m.State(), nil
}

func (m *Manager) StartReplay(settings ReplaySettings) (ToolState, error) {
	normalized, err := normalizeReplaySettings(settings)
	if err != nil {
		return ToolState{}, err
	}
	if !m.serial.Status().Open {
		return ToolState{}, errSerialNotOpen()
	}

	m.mu.Lock()
	if m.player.Count() == 0 {
		m.mu.Unlock()
		return ToolState{}, errNoReplayData()
	}
	m.mu.Unlock()

	m.Stop()

	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	m.player.Reset()
	m.runID++
	runID := m.runID
	m.cancelRun = cancel
	m.mode = "replay"
	m.startedAt = time.Now()
	m.config.Replay = normalized
	m.mu.Unlock()

	go m.replayLoop(ctx, runID)
	return m.State(), nil
}

func (m *Manager) generateLoop(ctx context.Context, runID int) {
	for {
		m.mu.Lock()
		settings := cloneGeneratorSettings(m.config.Generator)
		m.mu.Unlock()

		lines := generateLines(settings, time.Now())
		m.mu.Lock()
		m.lastGenerated = append([]string(nil), lines...)
		m.mu.Unlock()

		if err := m.serial.WriteLines(lines); err != nil {
			m.finishRun(runID)
			return
		}

		timer := time.NewTimer(time.Duration(settings.SendIntervalMs) * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (m *Manager) replayLoop(ctx context.Context, runID int) {
	for {
		m.mu.Lock()
		settings := m.config.Replay
		interval := time.Duration(float64(m.config.Generator.SendIntervalMs)/settings.ReplaySpeed) * time.Millisecond
		lines, ok := m.player.NextLines(settings, time.Now())
		m.mu.Unlock()

		if !ok {
			m.finishRun(runID)
			return
		}
		if err := m.serial.WriteLines(lines); err != nil {
			m.finishRun(runID)
			return
		}

		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (m *Manager) finishRun(runID int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.runID == runID {
		m.cancelRun = nil
		m.mode = ""
		m.startedAt = time.Time{}
	}
}

func generateLines(settings GeneratorSettings, timestamp time.Time) []string {
	generator := NewSentenceGenerator(settings)
	return generator.GenerateOrderedSet(timestamp, settings.SentenceOrder, settings.SentenceEnabled)
}
