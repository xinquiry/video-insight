FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/gateway ./cmd/gateway

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/gateway /usr/local/bin/gateway
USER nonroot
EXPOSE 8200
ENTRYPOINT ["/usr/local/bin/gateway"]
