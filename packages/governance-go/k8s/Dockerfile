# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
#
# Multi-stage build for the AumOS governance admission webhook binary.
# Stage 1 (builder): compiles the Go binary with CGO disabled for a fully
#                    static executable.
# Stage 2 (runtime): copies only the binary into a distroless/static image,
#                    keeping the attack surface minimal.

FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy dependency manifests first so Docker layer caching skips the
# go mod download step when only source files change.
COPY go.mod go.sum ./
RUN go mod download

# Copy the full module source.
COPY . .

# Build a fully static binary. -trimpath removes local file system paths
# from stack traces. -ldflags="-s -w" strips debug info to reduce image size.
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
      -trimpath \
      -ldflags="-s -w" \
      -o /webhook \
      ./k8s/admission/cmd/main.go

# --- runtime stage ---
FROM gcr.io/distroless/static:nonroot

COPY --from=builder /webhook /webhook

# Port the webhook HTTPS server listens on.
EXPOSE 8443

USER nonroot:nonroot

ENTRYPOINT ["/webhook"]
