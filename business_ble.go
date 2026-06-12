package main

import (
	"net/http"

	"localweb/internal/business/ble"
)

func registerBusinessRoutes(mux *http.ServeMux) {
	ble.RegisterRoutes(mux)
}
