package nmea

import (
	"bufio"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

type NMEAFrame struct {
	Timestamp        time.Time `json:"timestamp"`
	Sentences        []string  `json:"sentences"`
	Latitude         float64   `json:"latitude"`
	Longitude        float64   `json:"longitude"`
	Altitude         float64   `json:"altitude"`
	Speed            float64   `json:"speed"`
	Course           float64   `json:"course"`
	HasValidPosition bool      `json:"hasValidPosition"`
}

type NMEARecord struct {
	Timestamp        string   `json:"timestamp"`
	Sentences        []string `json:"sentences"`
	Latitude         float64  `json:"latitude"`
	Longitude        float64  `json:"longitude"`
	Altitude         float64  `json:"altitude"`
	Speed            float64  `json:"speed"`
	Course           float64  `json:"course"`
	HasValidPosition bool     `json:"hasValidPosition"`
}

type ReplayPlayer struct {
	fileName          string
	frames            []NMEAFrame
	currentIndex      int
	firstSentenceType string
}

func NewReplayPlayer() *ReplayPlayer {
	return &ReplayPlayer{
		frames:       make([]NMEAFrame, 0),
		currentIndex: 0,
	}
}

func (p *ReplayPlayer) Load(fileName string, reader io.Reader) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 1024), 1024*1024)

	var frames []NMEAFrame
	var currentFrame *NMEAFrame
	firstSentenceType := ""

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "$") {
			continue
		}

		sentenceType := getSentenceType(line)
		if sentenceType == "" {
			continue
		}
		if firstSentenceType == "" {
			firstSentenceType = sentenceType
		}
		if sentenceType == firstSentenceType {
			if currentFrame != nil && len(currentFrame.Sentences) > 0 {
				frames = append(frames, *currentFrame)
			}
			currentFrame = &NMEAFrame{
				Timestamp: time.Now().UTC(),
				Sentences: make([]string, 0),
			}
		}

		if currentFrame == nil {
			currentFrame = &NMEAFrame{
				Timestamp: time.Now().UTC(),
				Sentences: make([]string, 0),
			}
		}

		cleanLine := stripNMEALineEnding(line)
		currentFrame.Sentences = append(currentFrame.Sentences, cleanLine)
		parseFrameSentence(cleanLine, currentFrame)
	}

	if currentFrame != nil && len(currentFrame.Sentences) > 0 {
		frames = append(frames, *currentFrame)
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("读取回放数据失败: %w", err)
	}
	if len(frames) == 0 {
		return fmt.Errorf("没有解析到有效 NMEA 数据")
	}

	p.fileName = fileName
	p.frames = frames
	p.currentIndex = 0
	p.firstSentenceType = firstSentenceType
	return nil
}

func (p *ReplayPlayer) Reset() {
	p.currentIndex = 0
}

func (p *ReplayPlayer) Count() int {
	return len(p.frames)
}

func (p *ReplayPlayer) CurrentIndex() int {
	return p.currentIndex
}

func (p *ReplayPlayer) CurrentRecord() *NMEARecord {
	if p.currentIndex < 0 || p.currentIndex >= len(p.frames) {
		return nil
	}
	return frameToRecord(p.frames[p.currentIndex])
}

func (p *ReplayPlayer) State() ReplayStatus {
	return ReplayStatus{
		Loaded:        len(p.frames) > 0,
		FileName:      p.fileName,
		RecordCount:   len(p.frames),
		CurrentIndex:  p.currentIndex,
		CurrentRecord: p.CurrentRecord(),
	}
}

func (p *ReplayPlayer) NextLines(settings ReplaySettings, now time.Time) ([]string, bool) {
	if len(p.frames) == 0 {
		return nil, false
	}
	if p.currentIndex >= len(p.frames) {
		if !settings.LoopPlayback {
			return nil, false
		}
		p.currentIndex = 0
	}

	frame := p.frames[p.currentIndex]
	p.currentIndex++
	return buildReplayLines(frame, settings.UpdateTimestamp, now), true
}

func getSentenceType(line string) string {
	if !strings.HasPrefix(line, "$") {
		return ""
	}
	data := strings.TrimPrefix(line, "$")
	if index := strings.Index(data, "*"); index >= 0 {
		data = data[:index]
	}
	fields := strings.Split(data, ",")
	if len(fields) == 0 {
		return ""
	}
	return strings.TrimSpace(fields[0])
}

func parseFrameSentence(line string, frame *NMEAFrame) {
	data := strings.TrimPrefix(line, "$")
	if index := strings.Index(data, "*"); index >= 0 {
		data = data[:index]
	}

	fields := strings.Split(data, ",")
	if len(fields) == 0 {
		return
	}

	sentenceType := fields[0]
	if strings.HasSuffix(sentenceType, "GGA") {
		parseGGA(fields, frame)
	}
	if strings.HasSuffix(sentenceType, "RMC") {
		parseRMC(fields, frame)
	}
}

func parseGGA(fields []string, frame *NMEAFrame) {
	if len(fields) < 10 {
		return
	}

	if fields[1] != "" {
		if timestamp, err := parseNMEATime(fields[1], ""); err == nil {
			frame.Timestamp = timestamp
		}
	}
	if fields[2] != "" && fields[3] != "" {
		if latitude, err := parseCoordinate(fields[2], fields[3]); err == nil {
			frame.Latitude = latitude
			frame.HasValidPosition = true
		}
	}
	if fields[4] != "" && fields[5] != "" {
		if longitude, err := parseCoordinate(fields[4], fields[5]); err == nil {
			frame.Longitude = longitude
			frame.HasValidPosition = true
		}
	}
	if fields[9] != "" {
		if altitude, err := strconv.ParseFloat(fields[9], 64); err == nil {
			frame.Altitude = altitude
		}
	}
}

func parseRMC(fields []string, frame *NMEAFrame) {
	if len(fields) < 9 {
		return
	}

	if len(fields) > 9 && fields[1] != "" && fields[9] != "" {
		if timestamp, err := parseNMEATime(fields[1], fields[9]); err == nil {
			frame.Timestamp = timestamp
		}
	}
	if len(fields) > 4 && fields[3] != "" && fields[4] != "" {
		if latitude, err := parseCoordinate(fields[3], fields[4]); err == nil {
			frame.Latitude = latitude
			frame.HasValidPosition = true
		}
	}
	if len(fields) > 6 && fields[5] != "" && fields[6] != "" {
		if longitude, err := parseCoordinate(fields[5], fields[6]); err == nil {
			frame.Longitude = longitude
			frame.HasValidPosition = true
		}
	}
	if len(fields) > 7 && fields[7] != "" {
		if speed, err := strconv.ParseFloat(fields[7], 64); err == nil {
			frame.Speed = speed
		}
	}
	if fields[8] != "" {
		if course, err := strconv.ParseFloat(fields[8], 64); err == nil {
			frame.Course = course
		}
	}
}

func parseNMEATime(timeValue string, dateValue string) (time.Time, error) {
	if len(timeValue) < 6 {
		return time.Time{}, fmt.Errorf("时间格式错误")
	}

	hour, err := strconv.Atoi(timeValue[0:2])
	if err != nil {
		return time.Time{}, err
	}
	minute, err := strconv.Atoi(timeValue[2:4])
	if err != nil {
		return time.Time{}, err
	}
	second, err := strconv.Atoi(timeValue[4:6])
	if err != nil {
		return time.Time{}, err
	}

	now := time.Now().UTC()
	year, month, day := now.Year(), int(now.Month()), now.Day()
	if len(dateValue) >= 6 {
		if parsedDay, err := strconv.Atoi(dateValue[0:2]); err == nil {
			day = parsedDay
		}
		if parsedMonth, err := strconv.Atoi(dateValue[2:4]); err == nil {
			month = parsedMonth
		}
		if parsedYear, err := strconv.Atoi(dateValue[4:6]); err == nil {
			year = 2000 + parsedYear
		}
	}

	return time.Date(year, time.Month(month), day, hour, minute, second, 0, time.UTC), nil
}

func parseCoordinate(value string, direction string) (float64, error) {
	if value == "" {
		return 0, fmt.Errorf("坐标为空")
	}

	degreeDigits := 2
	if direction == "E" || direction == "W" {
		degreeDigits = 3
	}
	if len(value) <= degreeDigits {
		return 0, fmt.Errorf("坐标格式错误")
	}

	degrees, err := strconv.ParseFloat(value[:degreeDigits], 64)
	if err != nil {
		return 0, err
	}
	minutes, err := strconv.ParseFloat(value[degreeDigits:], 64)
	if err != nil {
		return 0, err
	}

	coordinate := degrees + minutes/60
	if direction == "S" || direction == "W" {
		coordinate = -coordinate
	}
	return coordinate, nil
}

func frameToRecord(frame NMEAFrame) *NMEARecord {
	return &NMEARecord{
		Timestamp:        frame.Timestamp.Format(time.RFC3339Nano),
		Sentences:        append([]string(nil), frame.Sentences...),
		Latitude:         frame.Latitude,
		Longitude:        frame.Longitude,
		Altitude:         frame.Altitude,
		Speed:            frame.Speed,
		Course:           frame.Course,
		HasValidPosition: frame.HasValidPosition,
	}
}

func buildReplayLines(frame NMEAFrame, updateTimestamp bool, now time.Time) []string {
	lines := make([]string, 0, len(frame.Sentences))
	for _, sentence := range frame.Sentences {
		if updateTimestamp {
			sentence = updateSentenceTime(sentence, now)
		}
		lines = append(lines, stripNMEALineEnding(sentence)+"\r\n")
	}
	return lines
}

func updateSentenceTime(sentence string, now time.Time) string {
	if !strings.HasPrefix(sentence, "$") {
		return sentence
	}

	data := strings.TrimPrefix(sentence, "$")
	if index := strings.Index(data, "*"); index >= 0 {
		data = data[:index]
	}

	fields := strings.Split(data, ",")
	if len(fields) < 2 {
		return sentence
	}

	sentenceType := fields[0]
	if strings.HasSuffix(sentenceType, "RMC") && len(fields) >= 10 {
		fields[1] = formatNMEATime(now, fields[1])
		fields[9] = now.UTC().Format("020106")
	}
	if strings.HasSuffix(sentenceType, "GGA") && len(fields) >= 2 {
		fields[1] = formatNMEATime(now, fields[1])
	}

	updatedData := strings.Join(fields, ",")
	return fmt.Sprintf("$%s*%02X", updatedData, calculateChecksum(updatedData))
}

func formatNMEATime(now time.Time, previous string) string {
	if strings.Contains(previous, ".") {
		return now.UTC().Format("150405.000")
	}
	return now.UTC().Format("150405")
}
