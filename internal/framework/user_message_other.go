//go:build !windows

package framework

import "log"

func showUserMessage(title, format string, args ...any) {
	log.Printf("[%s] "+format, append([]any{title}, args...)...)
}

func showUserError(title, format string, args ...any) {
	log.Printf("[%s] "+format, append([]any{title}, args...)...)
}
