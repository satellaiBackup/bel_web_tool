package framework

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type BusinessRouteRegistrar func(mux *http.ServeMux)

func RunLocalWebApp(config AppConfig, registerRoutes BusinessRouteRegistrar) error {
	addr := net.JoinHostPort(config.Host, config.Port)
	url := fmt.Sprintf("http://%s/%s", addr, config.StartPage)

	listener, err := net.Listen("tcp", addr)
	if err != nil {
		if isExistingInstance(config, addr) {
			showUserMessage("程序已打开", "程序已经在运行。\n\n访问地址：\n%s\n\n点击确定后会打开浏览器。", url)
			openOrPrompt(url)
			return nil
		}
		return fmt.Errorf("port %s is already in use. Please close the program using that port and try again", addr)
	}
	defer listener.Close()

	mux := http.NewServeMux()
	mux.HandleFunc(config.ProbePath, handleAppInfo(config))
	staticRoot := filepath.Join(config.RootDir, config.StaticDir)
	if config.ManifestPath != "" {
		mux.HandleFunc("/"+config.ManifestPath, handleManifest(staticRoot, config.ManifestPath))
	}
	if registerRoutes != nil {
		registerRoutes(mux)
	}

	mux.Handle("/", handleStatic(staticRoot))

	server := &http.Server{Handler: loggingMiddleware(mux)}
	trayOptions := TrayOptions{
		URL:             url,
		IconPath:        filepath.Join(config.RootDir, config.IconPath),
		Tooltip:         config.TrayTooltip,
		WindowClassName: config.WindowClassName,
		WindowTitle:     config.WindowTitle,
		OpenMenuText:    config.OpenMenuText,
		ExitMenuText:    config.ExitMenuText,
		VersionText:     VersionMenuText(),
		OnExit: func() {
			_ = server.Close()
		},
	}
	if err := startTray(trayOptions); err != nil {
		log.Printf("[WARN] unable to start tray icon: %v", err)
	}

	if config.AutoOpenBrowser {
		go openOrPrompt(url)
	}

	log.Printf("serving %s", staticRoot)
	log.Printf("listening on %s", addr)
	log.Printf("opening %s", url)

	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("local service failed: %w", err)
	}
	return nil
}

func handleAppInfo(config AppConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(config.ProbeHeader, config.ProbeValue)
		w.Header().Set("X-App-Version", Version())
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte(config.ProbeValue))
	}
}

func handleManifest(staticRoot, manifestPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
		http.ServeFile(w, r, filepath.Join(staticRoot, manifestPath))
	}
}

func handleStatic(staticRoot string) http.Handler {
	fileServer := http.FileServer(http.Dir(staticRoot))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/legacy/") {
			w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
			w.Header().Set("Pragma", "no-cache")
			w.Header().Set("Expires", "0")
		}
		fileServer.ServeHTTP(w, r)
	})
}

func isExistingInstance(config AppConfig, addr string) bool {
	client := http.Client{Timeout: 600 * time.Millisecond}
	resp, err := client.Get(fmt.Sprintf("http://%s%s", addr, config.ProbePath))
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.Header.Get(config.ProbeHeader) == config.ProbeValue
}

func openOrPrompt(url string) {
	if err := openBrowser(url); err != nil {
		log.Printf("[WARN] unable to open browser automatically: %v", err)
		log.Printf("[INFO] please open %s manually", url)
		showUserMessage("请手动打开页面", "服务已经启动，但无法自动打开浏览器。\n\n请在浏览器中访问：\n%s", url)
	}
}

func FatalStartupError(format string, args ...any) {
	showUserError("启动失败", format, args...)
	log.Fatalf(format, args...)
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(start))
	})
}

func openBrowser(target string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", target).Start()
	case "darwin":
		return exec.Command("open", target).Start()
	default:
		return exec.Command("xdg-open", target).Start()
	}
}

func DetermineRootDir() (string, error) {
	var candidates []string
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, cwd)
	}
	if exePath, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Dir(exePath))
	}

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(filepath.Join(candidate, appConfigFileName)); err == nil {
			return candidate, nil
		}
		if _, err := os.Stat(filepath.Join(candidate, "web", "index.html")); err == nil {
			return candidate, nil
		}
	}

	if len(candidates) > 0 && candidates[0] != "" {
		return candidates[0], nil
	}

	return "", fmt.Errorf("unable to resolve a directory containing index.html")
}
