# Application whitelist

- There is no application whitelist. It was retired: nothing has enforced `helpers/repositories.json` since the method that read it was written without a caller in July 2024, `/apps/whitelistedrepositories` returns an empty list unconditionally, and the file has now been deleted.
- What the network does enforce is a blocklist, and it does not live here. Images, app owners and app hashes that may not run are listed in `blockedrepositories.json` in [RunOnFlux/fluxos-network-policy](https://github.com/RunOnFlux/fluxos-network-policy), which every node fetches directly - so a change there takes effect without a release, and a pull request on this repository cannot alter it.

# What do you want to Run On Flux?

*Please describe what application(s) do you plan to run.*

# Is your desired application running somewhere already?

*Please provide a POC link to application if it is already running somewhere. (optional)*

# Is your application open source?

*Please provide a source code (optional)*

# Checklist:

- [ ] Whitelist of application is only modifying repositories.json file
- [ ] repositories.json is still a valid JSON file
- [ ] Only whitelists single docker image organisation (one whitelist at a time, more whitelists, more PRs)
- [ ] No other whitelist has been deleted
- [ ] I agree with ToS https://cdn.runonflux.io/Flux_Terms_of_Service.pdf
- [ ] Application follows ToS - Application is not malicious. Application is not a scam. Application does what is meant to do and does not mislead in any way. Application does not do anything illegal. Application is not a mining application (not even bandwidth mining).
- [ ] In case application receives multiple reports, behaves maliciously, it will be blacklisted and removed from the network.
