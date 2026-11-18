# syntax=docker/dockerfile:1
# Momo build: the official image with Peach renamed to Momo, a rebuilt frontend and the Momo icon on top.
# Build from the repo root: docker buildx build -f i18n/Dockerfile .
# BASE must be the official image of the release this branch is based on.
ARG BASE=longmeidao/peach:0.59.0@sha256:8b43332a9e2d37c5e935848b9a05d2edc6f5055a53ac88a6f9c767cd55a80edc

FROM python:3.15.1-slim-trixie@sha256:533b0b2f9b5d46fd097091cf826f27902f1d6c3bca714b6dc74551356aa97a51 AS py
WORKDIR /w
COPY src ./src
COPY tools/amane-bridge/bridge.py ./tools/amane-bridge/
COPY resources/media-sources.json ./resources/
COPY i18n/py.py i18n/en.json i18n/allow.txt ./i18n/
COPY i18n/brand/momo-logo-64.png ./i18n/brand/
RUN python -I i18n/py.py apply . i18n/en.json

FROM node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS web
WORKDIR /w
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund --ignore-scripts
COPY frontend ./frontend
COPY web ./web
COPY resources ./resources
COPY --from=py /w/resources/media-sources.json ./resources/
COPY i18n/ts.mjs i18n/en.json i18n/allow.txt i18n/backend-strings.json ./i18n/
RUN node i18n/ts.mjs apply . i18n/en.json && cd frontend && npm run build

FROM ${BASE}
ARG PKG=/app/.venv/lib/python3.15/site-packages/peach
USER root
COPY --from=py /w/src/peach/ ${PKG}/
COPY --from=py /w/tools/amane-bridge/bridge.py ${PKG}/_resources/tools/amane-bridge/bridge.py
COPY --from=py /w/tools/amane-bridge/bridge.py /app/tools/amane-bridge/bridge.py
COPY --from=web /w/web/ ${PKG}/_resources/web/
COPY --from=py /w/resources/media-sources.json ${PKG}/_resources/resources/
COPY --from=web /w/resources/locales/ ${PKG}/_resources/resources/locales/
# Own icon under the old file names, so routes and pages need no change.
COPY i18n/brand/momo-logo.png ${PKG}/_resources/resources/peach-logo.png
COPY i18n/brand/momo-logo-128.png ${PKG}/_resources/resources/peach-logo-128.png
COPY i18n/brand/momo-logo-64.png ${PKG}/_resources/resources/peach-logo-64.png
COPY i18n/brand/momo.ico ${PKG}/_resources/resources/peach.ico
RUN python -m compileall -q ${PKG} && /app/amane-runtime/.venv/bin/python -X utf8 /app/tools/amane-bridge/bridge.py --self-check
LABEL org.opencontainers.image.title="Momo" \
      org.opencontainers.image.description="Fork of Peach (github.com/peach-mitao/peach) under its own name and icon" \
      org.opencontainers.image.source="https://github.com/SinnerCode/momo"
ENV PEACH_LANGUAGE=en
USER peach
