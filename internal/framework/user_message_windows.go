//go:build windows

package framework

import (
	"fmt"
	"syscall"
	"unsafe"
)

const (
	messageBoxIconInformation = 0x00000040
	messageBoxIconError       = 0x00000010
	messageBoxTopMost         = 0x00040000
)

var (
	user32DLL      = syscall.NewLazyDLL("user32.dll")
	messageBoxProc = user32DLL.NewProc("MessageBoxW")
)

func showUserMessage(title, format string, args ...any) {
	showMessageBox(title, fmt.Sprintf(format, args...), messageBoxIconInformation)
}

func showUserError(title, format string, args ...any) {
	showMessageBox(title, fmt.Sprintf(format, args...), messageBoxIconError)
}

func showMessageBox(title, message string, icon uint32) {
	messagePtr, _ := syscall.UTF16PtrFromString(message)
	titlePtr, _ := syscall.UTF16PtrFromString(title)
	messageBoxProc.Call(
		0,
		uintptr(unsafe.Pointer(messagePtr)),
		uintptr(unsafe.Pointer(titlePtr)),
		uintptr(icon|messageBoxTopMost),
	)
}
