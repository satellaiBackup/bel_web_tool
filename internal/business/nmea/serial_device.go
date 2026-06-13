package nmea

import (
	"fmt"
	"sync"

	serialapi "go.bug.st/serial"
)

type SerialDevice struct {
	mu     sync.Mutex
	port   serialapi.Port
	config SerialConfig
}

func NewSerialDevice(config SerialConfig) *SerialDevice {
	normalized, err := normalizeSerialConfig(config, false)
	if err != nil {
		normalized = defaultConfig().Serial
	}
	return &SerialDevice{config: normalized}
}

func ListSerialPorts() ([]string, error) {
	ports, err := serialapi.GetPortsList()
	if err != nil {
		return nil, fmt.Errorf("获取串口列表失败: %w", err)
	}
	return ports, nil
}

func (d *SerialDevice) Open(config SerialConfig) error {
	normalized, err := normalizeSerialConfig(config, true)
	if err != nil {
		return err
	}

	mode := &serialapi.Mode{
		BaudRate: normalized.BaudRate,
		DataBits: normalized.DataBits,
		StopBits: serialapi.StopBits(normalized.StopBits),
		Parity:   serialapi.Parity(normalized.Parity),
	}

	port, err := serialapi.Open(normalized.PortName, mode)
	if err != nil {
		return fmt.Errorf("打开串口失败: %w", err)
	}

	d.mu.Lock()
	oldPort := d.port
	d.port = port
	d.config = normalized
	d.mu.Unlock()

	if oldPort != nil {
		_ = oldPort.Close()
	}
	return nil
}

func (d *SerialDevice) Close() error {
	d.mu.Lock()
	port := d.port
	d.port = nil
	d.mu.Unlock()

	if port == nil {
		return nil
	}
	if err := port.Close(); err != nil {
		return fmt.Errorf("关闭串口失败: %w", err)
	}
	return nil
}

func (d *SerialDevice) WriteLines(lines []string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.port == nil {
		return fmt.Errorf("串口未打开")
	}
	for _, line := range lines {
		if _, err := d.port.Write([]byte(line)); err != nil {
			return fmt.Errorf("写入串口失败: %w", err)
		}
	}
	return nil
}

func (d *SerialDevice) Status() SerialStatus {
	d.mu.Lock()
	defer d.mu.Unlock()

	return SerialStatus{
		Open:     d.port != nil,
		PortName: d.config.PortName,
		BaudRate: d.config.BaudRate,
		DataBits: d.config.DataBits,
		StopBits: d.config.StopBits,
		Parity:   d.config.Parity,
	}
}
