package main

import (
	"net/http"

	"localweb/internal/business/ble"
	"localweb/internal/business/nmea"
)

func registerBusinessRoutes(mux *http.ServeMux) {
	ble.RegisterRoutes(mux)
	nmea.RegisterRoutes(mux)
}
