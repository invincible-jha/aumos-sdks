// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

// Command webhook is the AumOS governance ValidatingWebhook server.
//
// It starts an HTTPS server that receives admission review requests from the
// Kubernetes API server and validates that every AI agent Pod declares the
// required governance annotations before being admitted to the cluster.
//
// # Usage
//
//	webhook -port 8443 \
//	        -cert /tls/tls.crt \
//	        -key  /tls/tls.key \
//	        -required-annotations aumos.ai/trust-level,aumos.ai/audit-enabled
//
// # Flags
//
//	-port                  TCP port to listen on (default: 8443)
//	-cert                  Path to TLS certificate PEM file (required)
//	-key                   Path to TLS private key PEM file (required)
//	-required-annotations  Comma-separated list of annotation keys to enforce
//	                        (default: all four standard governance annotations)
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/aumos-ai/aumos-sdks/go/governance/k8s/admission"
)

func main() {
	os.Exit(run())
}

// run contains the application logic. It returns an OS exit code so that
// main() can call os.Exit after deferred functions have run.
func run() int {
	var (
		port                int
		certFile            string
		keyFile             string
		requiredAnnotations string
	)

	flag.IntVar(&port, "port", 8443, "TCP port the HTTPS server listens on")
	flag.StringVar(&certFile, "cert", "", "Path to TLS certificate PEM file (required)")
	flag.StringVar(&keyFile, "key", "", "Path to TLS private key PEM file (required)")
	flag.StringVar(&requiredAnnotations, "required-annotations", "",
		"Comma-separated governance annotation keys to enforce (default: all four standard keys)")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	if certFile == "" {
		logger.Error("webhook: -cert flag is required")
		return 1
	}
	if keyFile == "" {
		logger.Error("webhook: -key flag is required")
		return 1
	}

	var required []string
	if requiredAnnotations != "" {
		for _, key := range strings.Split(requiredAnnotations, ",") {
			key = strings.TrimSpace(key)
			if key != "" {
				required = append(required, key)
			}
		}
	}

	config := admission.WebhookConfig{
		Port:                port,
		CertFile:            certFile,
		KeyFile:             keyFile,
		RequiredAnnotations: required,
	}

	handler := admission.NewHandler(config, logger)

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	addr := fmt.Sprintf(":%d", port)
	server := &http.Server{
		Addr:    addr,
		Handler: mux,
		// Timeouts prevent slow-loris and connection exhaustion.
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	// Start the server in a goroutine so that the main goroutine can handle
	// OS signals for graceful shutdown.
	serverErr := make(chan error, 1)
	go func() {
		logger.Info("webhook: starting HTTPS server",
			slog.String("addr", addr),
			slog.String("cert", certFile),
		)
		serverErr <- server.ListenAndServeTLS(certFile, keyFile)
	}()

	// Block until a shutdown signal or a server startup error.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("webhook: server error", slog.String("error", err.Error()))
			return 1
		}

	case sig := <-quit:
		logger.Info("webhook: shutdown signal received", slog.String("signal", sig.String()))

		// Give in-flight requests a window to complete before the process exits.
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			logger.Error("webhook: graceful shutdown failed", slog.String("error", err.Error()))
			return 1
		}
		logger.Info("webhook: shutdown complete")
	}

	return 0
}
