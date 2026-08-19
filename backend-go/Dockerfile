FROM golang:1.26.6-alpine AS base
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download

FROM base AS dev
COPY . .
EXPOSE 8000
CMD ["go", "run", "./cmd/api"]

FROM base AS build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/videoinsight-api ./cmd/api

FROM alpine:3.23 AS production
RUN apk add --no-cache ca-certificates wget && addgroup -S app && adduser -S -G app app
COPY --from=build /out/videoinsight-api /usr/local/bin/videoinsight-api
USER app
EXPOSE 8000
CMD ["videoinsight-api"]
