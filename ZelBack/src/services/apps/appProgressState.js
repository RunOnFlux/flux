// Shared progress state management for apps
// These variables track installation and removal progress

let removalInProgress = false;
let installationInProgress = false;

module.exports = {
  // Getters and setters for progress state
  get removalInProgress() { return removalInProgress; },
  set removalInProgress(value) { removalInProgress = value; },
  
  get installationInProgress() { return installationInProgress; },
  set installationInProgress(value) { installationInProgress = value; },
};