package main

import (
	"net/http"

	"localweb/internal/framework"
)

func main() {
	rootDir, err := framework.DetermineRootDir()
	if err != nil {
		framework.FatalStartupError("Unable to locate the application directory: %v", err)
	}

	config := framework.LoadAppConfig(rootDir)
	if err := framework.RunLocalWebApp(config, func(mux *http.ServeMux) error {
		return registerBusinessRoutes(mux, config)
	}); err != nil {
		framework.FatalStartupError("%v", err)
	}
}
