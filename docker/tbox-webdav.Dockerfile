FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim AS production

ARG TARGETARCH
ARG TBOX_WEBDAV_VERSION=1.0.1

LABEL org.opencontainers.image.source="https://github.com/1357310795/TboxWebdav" \
      org.opencontainers.image.version="1.0.1" \
      org.opencontainers.image.licenses="GPL-2.0-only"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/* \
    && case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
         amd64) archive_arch="x64"; archive_sha="2ac391e389a3a6d6e841dad5bd83d94c10421ffc3b9d28c29fd07317ccb5a012" ;; \
         arm64) archive_arch="arm64"; archive_sha="72cbc4049631b3cebdc06b85d61bd79a1f9883943e16fab9621feb1d67ccf916" ;; \
         *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
       esac \
    && archive="TboxWebdav.Server.AspNetCore-linux-${archive_arch}-no-runtime.zip" \
    && curl -L --fail --silent --show-error \
         "https://github.com/1357310795/TboxWebdav/releases/download/v${TBOX_WEBDAV_VERSION}/${archive}" \
         -o /tmp/tbox.zip \
    && echo "${archive_sha}  /tmp/tbox.zip" | sha256sum -c - \
    && mkdir -p /opt/tbox /usr/share/licenses/TboxWebdav \
    && unzip -q /tmp/tbox.zip -d /opt/tbox \
    && curl -L --fail --silent --show-error \
         "https://raw.githubusercontent.com/1357310795/TboxWebdav/4537e22adf241158783fe26661b8081f9bc45e94/LICENSE.txt" \
         -o /usr/share/licenses/TboxWebdav/LICENSE.txt \
    && chmod +x /opt/tbox/TboxWebdav.Server.AspNetCore \
    && rm /tmp/tbox.zip \
    && useradd --system --no-create-home --uid 10001 tbox

COPY --chmod=755 docker/tbox-webdav-entrypoint.sh /usr/local/bin/tbox-webdav-entrypoint

USER tbox
EXPOSE 65472
ENTRYPOINT ["/usr/local/bin/tbox-webdav-entrypoint"]
