# Application whitelist

- Whitelist is in a place acting as a first defence against malicious people that want to misuse Flux in order to for example mine cryptocurrencies or distribute illegal or copyrighted material. 
- To whitelist an application for Flux, please adjust helpers/repositories.json file by adding your desired whitelist for a specific docker hub organisation (recommended), docker hub image or target a specific tag of an image:
- Valid Examples: runonflux, runonflux/website, runonflux/website:latest

# What do you want to Run On Flux?

*Please describe what application(s) do you plan to run.*

# Is your desired application running somewhere already?

*Please provide a POC link to application if it is already running somewhere. (optional)*

# Is your application open source?

*Please provide a source code (optional)*

# Checklist:

- [ ] Whitelist of application is only modifying repositories.json file
- [ ] repositories.json is still a valid JSON file
- [ ] Only whitelists single docker hub username (one whitelist at a time, more whitelists, more PRs)
- [ ] No other whitelist has been deleted
- [ ] I agree with ToS https://cdn.runonflux.io/Flux_Terms_of_Service.pdf
- [ ] Application follows ToS - Application is not malicious. Application is not a scam. Application does what is meant to do and does not mislead in any way. Application does not do anything illegal. Application is not a mining application (not even bandwidth mining).
- [ ] In case application receives multiple reports, behaves maliciously, it will be blacklisted and removed from the network.
