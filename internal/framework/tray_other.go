//go:build !windows

package framework

func startTray(_ TrayOptions) error {
	return nil
}
