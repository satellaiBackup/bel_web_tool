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
	rootDir, err := determineRootDir()
	if err != nil {
		log.Fatalf("failed to determine workspace directory: %v", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("failed to acquire a free port: %v", err)
	}
	defer listener.Close()

	addr := listener.Addr().String()
	url := fmt.Sprintf("http://%s/index.html", addr)

	bleManager := newBLEManager()
	mux := http.NewServeMux()
	bleManager.registerRoutes(mux)
	mux.Handle("/", http.FileServer(http.Dir(rootDir)))
	handler := loggingMiddleware(mux)

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

func determineRootDir() (string, error) {
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
		if _, err := os.Stat(filepath.Join(candidate, "index.html")); err == nil {
			return candidate, nil
		}
	}

	if len(candidates) > 0 && candidates[0] != "" {
		return candidates[0], nil
	}

	return "", fmt.Errorf("unable to resolve a directory containing index.html")
}
