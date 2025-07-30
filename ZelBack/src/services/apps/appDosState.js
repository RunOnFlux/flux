// Shared DOS state management for apps
// These variables track denial-of-service conditions for applications

let dosMessage = '';
let dosMountMessage = '';
let dosDuplicateAppMessage = '';
let dosState = 0;

module.exports = {
  // Getters and setters for DOS state
  get dosMessage() { return dosMessage; },
  set dosMessage(value) { dosMessage = value; },
  
  get dosMountMessage() { return dosMountMessage; },
  set dosMountMessage(value) { dosMountMessage = value; },
  
  get dosDuplicateAppMessage() { return dosDuplicateAppMessage; },
  set dosDuplicateAppMessage(value) { dosDuplicateAppMessage = value; },
  
  get dosState() { return dosState; },
  set dosState(value) { dosState = value; },
};