package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

func main() {
	rootDir, err := os.Getwd()
	if err != nil {
		log.Fatalf("failed to determine working directory: %v", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("failed to acquire a free port: %v", err)
	}
	defer listener.Close()

	addr := listener.Addr().String()
	url := fmt.Sprintf("http://%s/index.html", addr)

	fs := http.FileServer(http.Dir(rootDir))
	handler := loggingMiddleware(fs)

	go func() {
		// Give the server a brief moment to start accepting connections.
		time.Sleep(150 * time.Millisecond)
		if err := openBrowser(url); err != nil {
			log.Printf("[WARN] unable to open browser automatically: %v", err)
			log.Printf("[INFO] please open %s manually", url)
		}
	}()

	log.Printf("serving %s", rootDir)
	log.Printf("listening on %s", addr)
	log.Printf("opening %s", url)

	if err := http.Serve(listener, handler); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
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
	default: // linux, freebsd, etc.
		return exec.Command("xdg-open", target).Start()
	}
}

func init() {
	// Ensure relative paths resolve correctly when the executable is launched from elsewhere.
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	if err := os.Chdir(filepath.Dir(exePath)); err != nil {
		log.Printf("[WARN] failed to switch working directory: %v", err)
	}
}
