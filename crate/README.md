# scrape-le

Check whether a page is scrapeable before the scraper is written —
robots.txt, anti-bot vendors, rate limits and authentication walls,
from the command line.

**Status: scaffolding.** The binary builds and refuses honestly
(exit 2); the detection engine is being ported from the
[VS Code extension](https://github.com/nolindnaidoo/scrape-le#readme),
which ships from this same repository so the two frontends can never
answer a URL differently. The shared corpus lives at
[signatures/](https://github.com/nolindnaidoo/scrape-le/tree/main/signatures)
and
[fixtures/](https://github.com/nolindnaidoo/scrape-le/tree/main/fixtures),
and CI fails on drift.

<!-- crates.io does not rewrite relative links the way vsce does: every
     link and image in this file must be an absolute URL. -->
