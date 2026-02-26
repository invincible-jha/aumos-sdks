module github.com/aumos-ai/aumos-sdks/go/governance

go 1.22

// This module uses only the Go standard library.
// The middleware/grpc.go file defines its own interface types that mirror
// google.golang.org/grpc so that users can wire governance checks into their
// own gRPC interceptors without this module importing gRPC directly.
