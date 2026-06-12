//go:build windows

package framework

import (
	"fmt"
	"os"
	"runtime"
	"sync"
	"syscall"
	"unsafe"
)

const (
	trayCallbackMessage = 0x8001
	trayIconID          = 1

	menuOpenID = 1001
	menuExitID = 1002

	cwUseDefault = 0x80000000

	wmCommand       = 0x0111
	wmDestroy       = 0x0002
	wmRButtonUp     = 0x0205
	wmLButtonDblClk = 0x0203

	nifMessage = 0x00000001
	nifIcon    = 0x00000002
	nifTip     = 0x00000004

	nimAdd    = 0x00000000
	nimDelete = 0x00000002

	mfString    = 0x00000000
	mfGrayed    = 0x00000001
	mfDisabled  = 0x00000002
	mfSeparator = 0x00000800

	tpmRightButton = 0x0002

	imageIcon       = 1
	loadFromFile    = 0x00000010
	loadTransparent = 0x00000020
	idiApplication  = 32512

	smCXSmallIcon = 49
	smCYSmallIcon = 50
)

type point struct {
	X int32
	Y int32
}

type msg struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
}

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSm     uintptr
}

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

type notifyIconData struct {
	Size             uint32
	HWnd             uintptr
	ID               uint32
	Flags            uint32
	CallbackMessage  uint32
	Icon             uintptr
	Tip              [128]uint16
	State            uint32
	StateMask        uint32
	Info             [256]uint16
	VersionOrTimeout uint32
	InfoTitle        [64]uint16
	InfoFlags        uint32
	GUIDItem         guid
	BalloonIcon      uintptr
}

type windowsTray struct {
	hwnd    uintptr
	options TrayOptions
	once    sync.Once
}

var (
	kernel32DLL = syscall.NewLazyDLL("kernel32.dll")
	shell32DLL  = syscall.NewLazyDLL("shell32.dll")

	getModuleHandleProc = kernel32DLL.NewProc("GetModuleHandleW")
	shellNotifyIconProc = shell32DLL.NewProc("Shell_NotifyIconW")

	registerClassExProc     = user32DLL.NewProc("RegisterClassExW")
	createWindowExProc      = user32DLL.NewProc("CreateWindowExW")
	defWindowProc           = user32DLL.NewProc("DefWindowProcW")
	destroyWindowProc       = user32DLL.NewProc("DestroyWindow")
	getMessageProc          = user32DLL.NewProc("GetMessageW")
	translateMessageProc    = user32DLL.NewProc("TranslateMessage")
	dispatchMessageProc     = user32DLL.NewProc("DispatchMessageW")
	postQuitMessageProc     = user32DLL.NewProc("PostQuitMessage")
	loadIconProc            = user32DLL.NewProc("LoadIconW")
	loadImageProc           = user32DLL.NewProc("LoadImageW")
	getSystemMetricsProc    = user32DLL.NewProc("GetSystemMetrics")
	createPopupMenuProc     = user32DLL.NewProc("CreatePopupMenu")
	appendMenuProc          = user32DLL.NewProc("AppendMenuW")
	destroyMenuProc         = user32DLL.NewProc("DestroyMenu")
	getCursorPosProc        = user32DLL.NewProc("GetCursorPos")
	setForegroundWindowProc = user32DLL.NewProc("SetForegroundWindow")
	trackPopupMenuProc      = user32DLL.NewProc("TrackPopupMenu")

	activeTrayMu sync.Mutex
	activeTray   *windowsTray
)

func startTray(options TrayOptions) error {
	ready := make(chan error, 1)

	go func() {
		runtime.LockOSThread()
		tray := &windowsTray{options: options}
		if err := tray.run(ready); err != nil {
			ready <- err
		}
	}()

	return <-ready
}

func (t *windowsTray) run(ready chan<- error) error {
	instance, _, _ := getModuleHandleProc.Call(0)
	className := utf16Ptr(t.options.WindowClassName)
	wndProc := syscall.NewCallback(trayWindowProc)

	wc := wndClassEx{
		Size:      uint32(unsafe.Sizeof(wndClassEx{})),
		WndProc:   wndProc,
		Instance:  instance,
		ClassName: className,
	}
	if atom, _, err := registerClassExProc.Call(uintptr(unsafe.Pointer(&wc))); atom == 0 {
		return fmt.Errorf("RegisterClassExW failed: %v", err)
	}

	hwnd, _, err := createWindowExProc.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(utf16Ptr(t.options.WindowTitle))),
		0,
		cwUseDefault, cwUseDefault, cwUseDefault, cwUseDefault,
		0, 0, instance, 0,
	)
	if hwnd == 0 {
		return fmt.Errorf("CreateWindowExW failed: %v", err)
	}
	t.hwnd = hwnd

	activeTrayMu.Lock()
	activeTray = t
	activeTrayMu.Unlock()

	if err := t.addIcon(); err != nil {
		return err
	}

	ready <- nil

	var message msg
	for {
		ret, _, _ := getMessageProc.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if int32(ret) <= 0 {
			break
		}
		translateMessageProc.Call(uintptr(unsafe.Pointer(&message)))
		dispatchMessageProc.Call(uintptr(unsafe.Pointer(&message)))
	}

	t.removeIcon()
	return nil
}

func (t *windowsTray) addIcon() error {
	data := notifyIconData{
		Size:            uint32(unsafe.Sizeof(notifyIconData{})),
		HWnd:            t.hwnd,
		ID:              trayIconID,
		Flags:           nifMessage | nifIcon | nifTip,
		CallbackMessage: trayCallbackMessage,
		Icon:            loadTrayIcon(t.options.IconPath),
	}
	copyUTF16(data.Tip[:], t.options.Tooltip)

	if ok, _, err := shellNotifyIconProc.Call(nimAdd, uintptr(unsafe.Pointer(&data))); ok == 0 {
		return fmt.Errorf("Shell_NotifyIconW add failed: %v", err)
	}
	return nil
}

func loadTrayIcon(iconPath string) uintptr {
	if _, err := os.Stat(iconPath); err == nil {
		cx, _, _ := getSystemMetricsProc.Call(smCXSmallIcon)
		cy, _, _ := getSystemMetricsProc.Call(smCYSmallIcon)
		icon, _, _ := loadImageProc.Call(
			0,
			uintptr(unsafe.Pointer(utf16Ptr(iconPath))),
			imageIcon,
			cx,
			cy,
			loadFromFile|loadTransparent,
		)
		if icon != 0 {
			return icon
		}
	}

	icon, _, _ := loadIconProc.Call(0, idiApplication)
	return icon
}

func (t *windowsTray) removeIcon() {
	data := notifyIconData{
		Size: uint32(unsafe.Sizeof(notifyIconData{})),
		HWnd: t.hwnd,
		ID:   trayIconID,
	}
	shellNotifyIconProc.Call(nimDelete, uintptr(unsafe.Pointer(&data)))
}

func (t *windowsTray) open() {
	go openOrPrompt(t.options.URL)
}

func (t *windowsTray) exit() {
	t.once.Do(func() {
		t.removeIcon()
		if t.options.OnExit != nil {
			t.options.OnExit()
		}
		destroyWindowProc.Call(t.hwnd)
		postQuitMessageProc.Call(0)
	})
}

func (t *windowsTray) showMenu() {
	menu, _, _ := createPopupMenuProc.Call()
	if menu == 0 {
		return
	}
	defer destroyMenuProc.Call(menu)

	appendMenuProc.Call(menu, mfString, menuOpenID, uintptr(unsafe.Pointer(utf16Ptr(t.options.OpenMenuText))))
	appendMenuProc.Call(menu, mfSeparator, 0, 0)
	if t.options.VersionText != "" {
		appendMenuProc.Call(menu, mfString|mfDisabled|mfGrayed, 0, uintptr(unsafe.Pointer(utf16Ptr(t.options.VersionText))))
		appendMenuProc.Call(menu, mfSeparator, 0, 0)
	}
	appendMenuProc.Call(menu, mfString, menuExitID, uintptr(unsafe.Pointer(utf16Ptr(t.options.ExitMenuText))))

	var cursor point
	getCursorPosProc.Call(uintptr(unsafe.Pointer(&cursor)))
	setForegroundWindowProc.Call(t.hwnd)
	trackPopupMenuProc.Call(menu, tpmRightButton, uintptr(cursor.X), uintptr(cursor.Y), 0, t.hwnd, 0)
}

func trayWindowProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	activeTrayMu.Lock()
	tray := activeTray
	activeTrayMu.Unlock()

	switch message {
	case trayCallbackMessage:
		if tray == nil {
			break
		}
		switch uint32(lParam) {
		case wmLButtonDblClk:
			tray.open()
			return 0
		case wmRButtonUp:
			tray.showMenu()
			return 0
		}
	case wmCommand:
		if tray == nil {
			break
		}
		switch uint16(wParam & 0xffff) {
		case menuOpenID:
			tray.open()
			return 0
		case menuExitID:
			tray.exit()
			return 0
		}
	case wmDestroy:
		postQuitMessageProc.Call(0)
		return 0
	}

	ret, _, _ := defWindowProc.Call(hwnd, uintptr(message), wParam, lParam)
	return ret
}

func utf16Ptr(s string) *uint16 {
	ptr, _ := syscall.UTF16PtrFromString(s)
	return ptr
}

func copyUTF16(dst []uint16, src string) {
	encoded := syscall.StringToUTF16(src)
	if len(encoded) > len(dst) {
		encoded = encoded[:len(dst)]
		encoded[len(encoded)-1] = 0
	}
	copy(dst, encoded)
}
