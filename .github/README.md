<p align="center"><img src="assets/momo-logo-256.png" alt="Momo logo" width="96"></p>

# Momo

Momo is a fork of [Peach](https://github.com/peach-mitao/peach), the self-hosted JAV metadata scraper and media manager, with the same features.

Since 0.58.0, Peach ships its own English interface, and Momo uses it. Momo is Peach under its own name and icon, with English as the default language.

Momo is an independent fork. The Peach project did not make it and does not endorse it. Please report Momo problems on [Momo's issue tracker](https://github.com/SinnerCode/momo/issues), not to Peach.

![Momo home screen in English](assets/momo-home.png)

<details>
<summary>More screenshots</summary>

![Settings page in English](assets/momo-settings.png)

![Follow page in English](assets/momo-follow.png)

</details>

## What you get

- Metadata scraping: recognizes video codes (番号), reads NFO files, and fills in titles, actresses, studios, series, tags and covers from several sources. Your own edits are kept.
- Local and cloud libraries: browse local drives, SMB shares, mounted cloud storage (CloudDrive2, 115, PikPak) and NAS folders in one library.
- Playback: a web player with subtitles, speed control, rotation, resume and timeline previews, plus external players.
- Follows and discovery: track actresses, studios and creators, see new releases, and keep a want list.
- Library management: tags, duplicates, versions, multi-part videos and watch history, all stored on your own machine.

Genre and tag names that come from scraped sites stay in their original language, because Momo matches them against the stored data.

## Run it with Docker

Momo runs as one container. It works on any Linux server, NAS (Synology, Unraid, TrueNAS, fnOS) or VPS that runs Docker.

```yaml
# compose.yaml
services:
  momo:
    image: ghcr.io/sinnercode/momo:0.59.0
    init: true
    restart: unless-stopped
    stop_grace_period: 75s
    ports:
      - "127.0.0.1:8900:8900"   # use your LAN IP instead of 127.0.0.1 for LAN access
    volumes:
      - momo-data:/data
      - /path/to/your/videos:/media:ro
volumes:
  momo-data:
```

1. Run `docker compose up -d`.
2. Run `docker compose exec momo peach token` to print the first-login token.
3. Open `http://<server>:8900`, log in with the token, then set an access password.
4. In **Momo Configuration**, add `/media` as a media folder and save with scanning turned on.

The container runs as UID 1000, so that user must be able to read your video folder. Hardware transcoding, CloudDrive2 and the other options work exactly as in [Peach's Docker guide](../docs/DOCKER.md) (in Chinese).

### Behind a reverse proxy

The settings pages refuse requests that carry proxy headers, and they check the page origin. If you put Momo behind Caddy or nginx, strip those headers and rewrite an HTTPS origin to HTTP. Caddy example:

```caddyfile
momo.example.lan {
	reverse_proxy momo:8900 {
		header_up -X-Forwarded-*
		header_up -Forwarded
		header_up Origin "^https://momo\.example\.lan$" "http://momo.example.lan"
	}
}
```

Keep Momo on your LAN or a VPN such as Tailscale. Like Peach, it is a single-user app with no accounts, and it should not face the public internet.

## How the build works

Momo does not change Peach's source files, so each new Peach release merges cleanly. The rename happens when the image is made:

- `i18n/ts.mjs` renames Peach to Momo in the interface text and the frontend, and `i18n/py.py` swaps the favicon.
- `i18n/Dockerfile` builds on top of the official Peach image for the same release and sets English as the default language.

See [`i18n/README.md`](../i18n/README.md) to update or build it yourself.

## License

AGPL-3.0-or-later, the same as Peach. Momo's source, including the build tooling, is this repository. Peach's name and icon belong to the Peach project (see its [name policy](../docs/TRADEMARKS.md)); Momo uses its own name and icon. Adults only: Momo is for legally released content featuring consenting adults.

<sub>Search terms: Peach English, Peach English version, Peach in English, Peach global version, Peach international version, Peach 英文版, peach-mitao English, peach.video English, English JAV metadata scraper, JAV library manager, self-hosted JAV media server, JAV NFO scraper, Docker, NAS.</sub>
