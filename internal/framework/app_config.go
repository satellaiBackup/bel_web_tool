package framework

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
)

const appConfigFileName = "app.config.json"

type AppConfig struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	ShortName       string `json:"shortName"`
	Host            string `json:"host"`
	Port            string `json:"port"`
	StartPage       string `json:"startPage"`
	StaticDir       string `json:"staticDir"`
	ManifestPath    string `json:"manifestPath"`
	IconPath        string `json:"iconPath"`
	ProbePath       string `json:"probePath"`
	ProbeHeader     string `json:"probeHeader"`
	ProbeValue      string `json:"probeValue"`
	WindowClassName string `json:"windowClassName"`
	WindowTitle     string `json:"windowTitle"`
	TrayTooltip     string `json:"trayTooltip"`
	OpenMenuText    string `json:"openMenuText"`
	ExitMenuText    string `json:"exitMenuText"`
	AutoOpenBrowser bool   `json:"autoOpenBrowser"`

	RootDir string `json:"-"`
}

func LoadAppConfig(rootDir string) AppConfig {
	config := defaultAppConfig(rootDir)
	configPath := filepath.Join(rootDir, appConfigFileName)

	data, err := os.ReadFile(configPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[WARN] unable to read %s: %v", configPath, err)
		}
		return config
	}

	if err := json.Unmarshal(data, &config); err != nil {
		log.Printf("[WARN] unable to parse %s: %v", configPath, err)
		return defaultAppConfig(rootDir)
	}

	config.RootDir = rootDir
	return normalizeAppConfig(config)
}

func defaultAppConfig(rootDir string) AppConfig {
	return normalizeAppConfig(AppConfig{
		ID:              "ble-web-tool",
		Name:            "蓝牙网页调试助手",
		ShortName:       "BLE Tool",
		Host:            "127.0.0.1",
		Port:            "51888",
		StartPage:       "index.html",
		StaticDir:       "web",
		ManifestPath:    "site.webmanifest",
		IconPath:        "web/assets/app.ico",
		ProbePath:       "/api/app-info",
		ProbeHeader:     "X-Local-Web-App",
		ProbeValue:      "ble-web-tool",
		WindowClassName: "LocalWebAppTrayWindow",
		WindowTitle:     "BLE Web Tool",
		TrayTooltip:     "BLE 网页调试助手",
		OpenMenuText:    "打开界面",
		ExitMenuText:    "退出",
		AutoOpenBrowser: true,
		RootDir:         rootDir,
	})
}

func normalizeAppConfig(config AppConfig) AppConfig {
	defaults := defaultAppConfigWithoutNormalize(config.RootDir)

	if config.ID == "" {
		config.ID = defaults.ID
	}
	if config.Name == "" {
		config.Name = defaults.Name
	}
	if config.ShortName == "" {
		config.ShortName = defaults.ShortName
	}
	if config.Host == "" {
		config.Host = defaults.Host
	}
	if config.Port == "" {
		config.Port = defaults.Port
	}
	if config.StartPage == "" {
		config.StartPage = defaults.StartPage
	}
	if config.StaticDir == "" {
		config.StaticDir = defaults.StaticDir
	}
	if config.ManifestPath == "" {
		config.ManifestPath = defaults.ManifestPath
	}
	if config.IconPath == "" {
		config.IconPath = defaults.IconPath
	}
	if config.ProbePath == "" {
		config.ProbePath = defaults.ProbePath
	}
	if config.ProbeHeader == "" {
		config.ProbeHeader = defaults.ProbeHeader
	}
	if config.ProbeValue == "" {
		config.ProbeValue = config.ID
	}
	if config.WindowClassName == "" {
		config.WindowClassName = defaults.WindowClassName
	}
	if config.WindowTitle == "" {
		config.WindowTitle = config.Name
	}
	if config.TrayTooltip == "" {
		config.TrayTooltip = config.Name
	}
	if config.OpenMenuText == "" {
		config.OpenMenuText = defaults.OpenMenuText
	}
	if config.ExitMenuText == "" {
		config.ExitMenuText = defaults.ExitMenuText
	}

	config.ProbePath = ensureLeadingSlash(config.ProbePath)
	config.StartPage = strings.TrimLeft(config.StartPage, "/\\")
	config.ManifestPath = strings.TrimLeft(config.ManifestPath, "/\\")
	config.IconPath = strings.TrimLeft(config.IconPath, "/\\")
	return config
}

func defaultAppConfigWithoutNormalize(rootDir string) AppConfig {
	return AppConfig{
		ID:              "local-web-app",
		Name:            "Local Web App",
		ShortName:       "Web App",
		Host:            "127.0.0.1",
		Port:            "51888",
		StartPage:       "index.html",
		StaticDir:       "web",
		ManifestPath:    "site.webmanifest",
		IconPath:        "web/assets/app.ico",
		ProbePath:       "/api/app-info",
		ProbeHeader:     "X-Local-Web-App",
		ProbeValue:      "local-web-app",
		WindowClassName: "LocalWebAppTrayWindow",
		WindowTitle:     "Local Web App",
		TrayTooltip:     "Local Web App",
		OpenMenuText:    "Open",
		ExitMenuText:    "Exit",
		AutoOpenBrowser: true,
		RootDir:         rootDir,
	}
}

func ensureLeadingSlash(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "/"
	}
	if strings.HasPrefix(value, "/") {
		return value
	}
	return "/" + value
}
