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
	"syscall"
	"time"

	"github.com/xinquiry/video-insight/gateway/internal/api"
	"github.com/xinquiry/video-insight/gateway/internal/auth"
	"github.com/xinquiry/video-insight/gateway/internal/smh"
)

func main() {
	address := flag.String("address", ":8200", "HTTP listen address")
	userTokenFile := flag.String("user-token-file", "/var/run/smh/user-token", "file containing the SJTU Drive UserToken")
	keysFile := flag.String("keys-file", "/var/run/smh/access-keys.json", "per-project access keys JSON")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	userToken, err := readFileTrimmed(*userTokenFile)
	if err != nil {
		logger.Error("read user token file", "error", err)
		os.Exit(1)
	}

	keys, err := auth.NewStore(*keysFile)
	if err != nil {
		logger.Error("load access keys", "error", err)
		os.Exit(1)
	}

	server := &http.Server{
		Addr:              *address,
		Handler:           api.NewServer(keys, smh.NewClient(userToken), logger).Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		logger.Info("sjtu-oss-gateway listening", "address", *address)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown", "error", err)
	}
}

func readFileTrimmed(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	token := string(raw)
	// Trim whitespace and any accidental quoting.
	for len(token) > 0 && (token[0] == '"' || token[0] == '\'' || token[len(token)-1] == '"' || token[len(token)-1] == '\'' || token[len(token)-1] == '\n' || token[len(token)-1] == '\r' || token[len(token)-1] == ' ') {
		if token[0] == '"' || token[0] == '\'' {
			token = token[1:]
		}
		if len(token) > 0 && (token[len(token)-1] == '"' || token[len(token)-1] == '\'' || token[len(token)-1] == '\n' || token[len(token)-1] == '\r' || token[len(token)-1] == ' ') {
			token = token[:len(token)-1]
		}
	}
	if token == "" {
		return "", fmt.Errorf("%s is empty", path)
	}
	return token, nil
}
