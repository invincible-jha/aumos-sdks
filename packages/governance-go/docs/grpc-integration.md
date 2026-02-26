# gRPC Integration

The governance middleware package defines its own interface types that mirror
`google.golang.org/grpc` so the `governance` module has zero external
dependencies. Users bridge the two type systems in their own application code.

## Why mirror types?

The governance module's `go.mod` has no `require` statements. This means any
Go application can import it — including those that do not use gRPC at all.
The gRPC middleware is still ergonomic because Go's structural type system
allows converting between identically shaped types.

## Unary interceptor

```go
import (
    "context"

    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/metadata"
    "google.golang.org/grpc/status"

    "github.com/aumos-ai/aumos-sdks/go/governance"
    govmw "github.com/aumos-ai/aumos-sdks/go/governance/middleware"
)

func buildUnaryInterceptor(engine *governance.GovernanceEngine) grpc.UnaryServerInterceptor {
    // Build the governance-side interceptor.
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

    // Wrap it as a real grpc.UnaryServerInterceptor.
    return func(
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
}
```

Then register it:

```go
server := grpc.NewServer(
    grpc.UnaryInterceptor(buildUnaryInterceptor(engine)),
)
```

## Streaming interceptor

```go
func buildStreamInterceptor(engine *governance.GovernanceEngine) grpc.StreamServerInterceptor {
    govInterceptor := govmw.GovernanceStreamInterceptor(engine,
        govmw.WithInterceptorAgentMetaKey("x-agent-id"),
        govmw.WithInterceptorRequiredTrust(governance.TrustActWithApproval),
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
    )

    return func(
        srv any,
        ss grpc.ServerStream,
        info *grpc.StreamServerInfo,
        handler grpc.StreamHandler,
    ) error {
        // Wrap the real grpc.ServerStream as a govmw.ServerStream.
        wrapped := &serverStreamWrapper{ss}
        return govInterceptor(srv, wrapped,
            &govmw.StreamServerInfo{
                FullMethod:     info.FullMethod,
                IsClientStream: info.IsClientStream,
                IsServerStream: info.IsServerStream,
            },
            func(srv any, stream govmw.ServerStream) error {
                return handler(srv, ss) // pass the original, unwrapped stream
            },
        )
    }
}

// serverStreamWrapper adapts grpc.ServerStream to govmw.ServerStream.
type serverStreamWrapper struct{ grpc.ServerStream }

func (w *serverStreamWrapper) Context() context.Context {
    return w.ServerStream.Context()
}
```

## Retrieving the Decision downstream

The interceptor stores the `*governance.Decision` in the gRPC context under
`middleware.DecisionContextKey`:

```go
func (s *myServer) SayHello(ctx context.Context, req *pb.HelloRequest) (*pb.HelloReply, error) {
    decision := govmw.DecisionFromGRPCContext(ctx)
    if decision != nil {
        log.Printf("governance decision: permitted=%v reason=%s", decision.Permitted, decision.Reason)
    }
    return &pb.HelloReply{Message: "Hello"}, nil
}
```

## Chaining with other interceptors

Use `google.golang.org/grpc/middleware/chain` (or your own chain helper) to
compose multiple interceptors:

```go
server := grpc.NewServer(
    grpc.ChainUnaryInterceptor(
        loggingInterceptor,
        buildUnaryInterceptor(engine),
        metricsInterceptor,
    ),
)
```

Governance runs after logging so the logger sees the request before it is
potentially denied, which is useful for debugging.

## Budget-gated streaming

For streaming RPCs where each message has a cost, perform per-message budget
checks inside your handler rather than at stream-open time:

```go
func (s *myServer) DataStream(req *pb.StreamReq, stream pb.MyService_DataStreamServer) error {
    ctx := stream.Context()
    for _, chunk := range data {
        result := engine.Budget.Check(ctx, "data-egress", float64(len(chunk)))
        if !result.Permitted {
            return status.Errorf(codes.ResourceExhausted, "budget: %s", result.Reason)
        }
        _ = engine.Budget.Record(ctx, "data-egress", float64(len(chunk)))
        if err := stream.Send(&pb.DataChunk{Payload: chunk}); err != nil {
            return err
        }
    }
    return nil
}
```
