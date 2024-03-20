![Flux.png](../../flux_banner.png)

---

# FluxOS local Testing

In order to test fluxOS on your local machine, using the supplied dockerfile, the following requirements need to be met:

* You must clone this repo.
* You must have a docker socket at `/var/run/docker.sock` on your machine, which the current user has permission to access.

## Notes

* Mounts your docker socket (`/var/run/docker.sock`) into a `socat` container - doesn't need to chown the file (so won't change ownership on the host, if on linux) as it's proxied via socat to the test container
* Mounts the repo root directory into the test container at `/home/fluxtesting/flux` for realtime testing
* tests are run as non root `fluxtesting` user
* Mongo container needs to be running, accessible from the testing container.
* Depending on the tests, the `runonflux:website` container must be running, accessible from the testing container.
* Syncthing should be running as root with `--home` of /$USER/.config/syncthing.
* Fluxd and Fluxbenchd don't nee to be running, but files must exist at `/usr/local/bin/flux{d,benchd}`

## How to run the tests

To run all unit tests:

```bash
npm run test:zelback:unit:compose
```

The above will do the following:
* purge any existing fluxos testing containers (using tags)
* pull down mongo, socat and flux website containers
* build the testing container from the local dockerfile
* start up containers
* attach to testing container
* run tests

With any luck, you should see the following:

_Note: The pending tests have been skipped and are fine to ignore_

```bash
tester  |
tester  |   1865 passing (1m)
tester  |   3 pending
tester  |
tester exited with code 0
Aborting on container exit...
[+] Stopping 4/4
 ✔ Container tester       Stopped
 ✔ Container mongo        Stopped
 ✔ Container fluxwebsite  Stopped
 ✔ Container socat        Stopped
[+] Running 5/0
 ✔ Container tester       Removed
 ✔ Container fluxwebsite  Removed
 ✔ Container socat        Removed
 ✔ Container mongo        Removed
 ✔ Network fluxos_test    Removed
 ```

To run a single test module:

```bash
npm run test:zelback:unit:oneoff tests/unit/dockerService.test.js
```

_Note: This will leave `mongo`, `socat` and `fluxwebsite` containers running_

To filter on specific test(s):

```bash
npm run test:zelback:unit:oneoff -- -g 'should remove a network' tests/unit/dockerService.test.js
```

To shut down all containers:

```bash
npm run test:zelback:container:down
```
