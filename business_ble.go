package main

import (
	"net/http"

	"localweb/internal/business/ble"
	"localweb/internal/business/esim"
	"localweb/internal/business/nmea"
	"localweb/internal/framework"
)

func registerBusinessRoutes(mux *http.ServeMux, config framework.AppConfig) error {
	ble.RegisterRoutes(mux)
	if err := esim.RegisterRoutes(mux, esim.HTTPSRelayConfig{
		AllowedHosts:        config.EsimHTTPSRelay.AllowedHosts,
		CACertFiles:         config.EsimHTTPSRelay.CACertFiles,
		MaxRequestBodyBytes: config.EsimHTTPSRelay.MaxRequestBodyBytes,
		RootDir:             config.RootDir,
	}); err != nil {
		return err
	}
	nmea.RegisterRoutes(mux)
	return nil
}
