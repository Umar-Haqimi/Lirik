# NOTICE

Lirik is free software under the GNU General Public License v3.0 (see `LICENSE`).

## Fork origin

Lirik is a fork of **PlasMusic Toolbar** — https://github.com/ccatterina/plasmusic-toolbar —
Copyright © Claudio Catterina and contributors, GPL-3.0. Forked at commit `0e78da1` (v4.3.1); the
upstream git history is preserved in this repository. Upstream's files keep their copyright.

## Behaviour references (no code copied)

- **Braccato** (`@braccato/parsers` 0.4.1) — https://github.com/better-lyrics/braccato — MIT.
  Lirik's TTML and LRC parsers were written to match Braccato's documented behaviour, and Braccato is
  used as a development-only test oracle (differential tests). It is not shipped.
- **Unison** server — https://github.com/better-lyrics/unison — AGPL-3.0. Read only to understand the
  API's behaviour. **No Unison code is copied into Lirik.**
- **Lyricsfile 1.0 draft** — https://github.com/tranxuanthang/lyricsfile.

## Lyrics providers

- **LRCLIB** — https://lrclib.net
- **Unison** by Better Lyrics — https://unison.betterlyrics.org. Lyrics shown from Unison are credited
  in the widget to Unison and to the community member who submitted them.

Lyrics are the property of their respective owners. This repository contains only synthetic
placeholder text in its test fixtures.
