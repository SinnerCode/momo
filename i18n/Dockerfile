# syntax=docker/dockerfile:1
# English build: the official image with translated Python and a rebuilt translated frontend on top.
# Build from the repo root: docker buildx build -f i18n/Dockerfile .
# BASE must be the official image of the release this branch is based on.
ARG BASE=longmeidao/peach:0.52.0@sha256:7b2160ea8569a57c707af9b2782754dacad309841152a19f8881b4ea5c929c60

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
# Own icon under the old file names, so routes and pages need no change.
COPY i18n/brand/momo-logo.png ${PKG}/_resources/resources/peach-logo.png
COPY i18n/brand/momo-logo-128.png ${PKG}/_resources/resources/peach-logo-128.png
COPY i18n/brand/momo-logo-64.png ${PKG}/_resources/resources/peach-logo-64.png
COPY i18n/brand/momo.ico ${PKG}/_resources/resources/peach.ico
RUN python -m compileall -q ${PKG} && /app/amane-runtime/.venv/bin/python -X utf8 /app/tools/amane-bridge/bridge.py --self-check
LABEL org.opencontainers.image.title="Momo" \
      org.opencontainers.image.description="English fork of Peach (github.com/peach-mitao/peach)" \
      org.opencontainers.image.source="https://github.com/SinnerCode/momo"
USER peach
