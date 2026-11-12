![Flux.png](../../flux_banner.png)

---

# FluxOS unit tests in containers

`tests/images/run-unit.sh` runs the unit suite as CI runs it (`.github/workflows/nodejs.yml`): Node 20.8.0, MongoDB 7.0, cron, `CI=true`, `npm run ciconfig` and `npm run prebuild`. The only requirement on the host is Docker with the compose plugin.

* Each run is a compose project of its own, with its own image, removed with its image and volumes when the run ends, so runs on one host never share an image, container, network or volume.
* No unit test asks a docker daemon, and the run has none: every docker answer a test reads is a stub.
* MongoDB keeps its data in memory (tmpfs), so a busy host disk does not slow the tests that create collections and indexes.
* The repo root is mounted at `/home/fluxtesting/flux` and the tests run as the non-root `fluxtesting` user (uid 1000). `npm install` runs in the mounted repo when `package.json` has changed since the last run.
* The exit status is mocha's.

## How to run the tests

Run from the repo root. The first run builds the test image.

To run all unit tests:

```bash
npm run test:zelback:unit:compose
```

To run a single test module:

```bash
npm run test:zelback:unit:compose -- tests/unit/dockerService.test.js
```

To filter on specific test(s):

```bash
npm run test:zelback:unit:compose -- -g 'removes the network' tests/unit/dockerService.test.js
```
