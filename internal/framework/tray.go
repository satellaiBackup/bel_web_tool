package framework

type TrayOptions struct {
	URL             string
	IconPath        string
	Tooltip         string
	WindowClassName string
	WindowTitle     string
	OpenMenuText    string
	ExitMenuText    string
	VersionText     string
	OnExit          func()
}
