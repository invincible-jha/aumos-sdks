// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

// Command grpc-server shows how to wire GovernanceUnaryInterceptor into a
// real gRPC server using the mirror types defined in the middleware package.
//
// This example has a build-tag guard because it requires an external
// google.golang.org/grpc dependency that the governance module does not
// import. Remove the build tag and add grpc to your own go.mod to run it.
//
//go:build grpc_example
// +build grpc_example

package main

import (
	"context"
	"fmt"
	"log"
	"net"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/aumos-ai/aumos-sdks/go/governance"
	govmw "github.com/aumos-ai/aumos-sdks/go/governance/middleware"
)

func main() {
	ctx := context.Background()

	// Build the governance engine.
	engine, err := governance.NewEngine(governance.Config{
		DefaultScope: "grpc",
	})
	if err != nil {
		log.Fatalf("create engine: %v", err)
	}

	// Assign trust to a known service account.
	_, _ = engine.Trust.SetLevel(ctx, "svc-frontend", governance.TrustActWithApproval, "grpc",
		governance.WithAssignedBy("owner"))

	// ---------------------------------------------------------------------------
	// Bridge governance interceptor to real gRPC types.
	//
	// The govmw package defines mirror types (UnaryServerInfo, UnaryHandler, etc.)
	// that are structurally equivalent to the grpc package types. We wrap the
	// governance interceptor in a real grpc.UnaryServerInterceptor here so the
	// governance module itself stays dependency-free.
	// ---------------------------------------------------------------------------
	govInterceptor := govmw.GovernanceUnaryInterceptor(engine,
		govmw.WithInterceptorAgentMetaKey("x-agent-id"),
		govmw.WithInterceptorRequiredTrust(governance.TrustSuggest),
		govmw.WithMetadataReader(func(ctx context.Context, key string) string {
			md, ok := metadata.FromIncomingContext(ctx)
			if !ok {
				return ""
			}
			vals := md.Get(key)
			if len(vals) == 0 {
				return ""
			}
			return vals[0]
		}),
		govmw.WithInterceptorDenyHandler(func(_ context.Context, reason string) error {
			return status.Errorf(codes.PermissionDenied, "governance: %s", reason)
		}),
	)

	grpcInterceptor := func(
		ctx context.Context,
		req any,
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (any, error) {
		return govInterceptor(ctx, req,
			&govmw.UnaryServerInfo{FullMethod: info.FullMethod},
			govmw.UnaryHandler(handler),
		)
	}

	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatalf("listen: %v", err)
	}

	srv := grpc.NewServer(grpc.UnaryInterceptor(grpcInterceptor))

	fmt.Println("gRPC governance server listening on :50051")
	if err := srv.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
