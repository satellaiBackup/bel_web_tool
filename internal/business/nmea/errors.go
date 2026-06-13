package nmea

import "errors"

func errSerialNotOpen() error {
	return errors.New("串口未打开")
}

func errNoReplayData() error {
	return errors.New("没有加载回放数据")
}
