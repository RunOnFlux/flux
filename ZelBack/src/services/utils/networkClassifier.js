// Is this node's address on an access (consumer) network, or in a data centre?
//
// The question `isDataCenter()` answers today is "did anything tell me this was
// hosting", so its false branch means "nothing told me", and absence of evidence
// reads as residential. Enforcing against that is what this module exists to
// avoid: here a node is RESIDENTIAL only when something positively says so and
// nothing contradicts it, and every other outcome is a state enforcement must
// leave alone.
//
// The four outcomes:
//   RESIDENTIAL  at least one positive signal, no contradiction
//   DATACENTER   at least one contradiction, no positive signal
//   CONFLICTED   both - the signals disagree, so we do not know
//   UNKNOWN      neither - nothing to go on
//
// CONFLICTED is not a rounding error on the way to a binary. Measured against
// every host in the fleet that ip-api positively asserts is hosting (1,569 hosts
// across all 29 hosting ASNs the fleet uses), this rule calls 0 of them
// residential - and 39 of them land in CONFLICTED. Those 39 trip a residential
// signal AND a contradiction; collapsing that bucket either way is precisely how
// the accuracy would be lost. See
// fluxModels/investigations/PR1784_RESIDENTIAL_DOS_BLAST_RADIUS.md §4.
//
// Signals are limited to what a node can determine about itself: the PTR record
// for its own address, the ip-api response geolocationService already fetches,
// and bench figures it already holds. Registration (RDAP) data separates these
// populations better still, but six thousand nodes cannot each query the RIRs -
// that signal belongs in the published location artifact, read as a table.

// Access-network vocabulary. Generic across ISPs worldwide, which is the
// property that makes it worth more than a list of provider names: it fires on
// Optus, Charter, Vodafone and Slovak Telekom without any of them being listed.
const PTR_RESIDENTIAL = [
  'dsl', 'ppp', 'dial', 'dyn', 'pool', 'dhcp', 'cpe', 'cust', 'client',
  'subscriber', 'subs.', 'user', 'home', 'broadband', 'bband', 'cable',
  'docsis', 'hsd', 'fios', 'lightspeed', 'bras', 'gpon', 'ftth', 'fibre',
  'abo.', 'wanadoo', 'hispeed', 'optusnet', 'res.', 'resnet', 'retail',
  'access', 'mobile', 'lte', 'wireless', 'wifi', 'ipoe', 'rev.', 'fixed.',
];

// Hosting vocabulary. Only ever read as a contradiction, never as evidence of
// anything by itself.
const PTR_DATACENTER = [
  'vps', 'vmi', 'srv', 'server', 'dedi', 'cloud', 'hosted', 'hosting',
  'colo', 'datacenter', 'datacentre', 'instance', 'compute', 'baremetal',
  'your-server', 'contabo', 'ovh', 'hetzner', 'linode', 'vultr',
  'digitalocean', 'amazonaws', 'azure', 'leaseweb', 'infomaniak', 'static.tds',
];

// Operators known to sell hosting. Matched against ip-api's `isp` and `as` -
// the network operator - and deliberately NOT against `org`, which is the block
// registrant and is frequently a reseller or downstream customer. The two
// disagree on 67% of fleet hosts: 46.250.240.89 carries isp "Contabo Asia
// Private Limited" and org "Yorkshire Tech Limited", and reading org is why
// Contabo appears on this list today and is still classified residential.
const HOSTING_OPERATORS = [
  'hetzner', 'ovh', 'netcup', 'hostnodes', 'contabo', 'hostslim', 'zayo',
  'cogent', 'lumen', 'digitalocean', 'linode', 'vultr', 'leaseweb', 'scaleway',
  'infomaniak', 'oracle', 'amazon', 'google', 'microsoft', 'azure', 'alibaba',
  'ionos', 'aruba', 'hostinger', 'namecheap', 'godaddy', 'upcloud',
];

const CLASSIFICATION = Object.freeze({
  RESIDENTIAL: 'RESIDENTIAL',
  DATACENTER: 'DATACENTER',
  CONFLICTED: 'CONFLICTED',
  UNKNOWN: 'UNKNOWN',
});

// An access link is typically far faster down than up. A symmetric link proves
// nothing either way - FTTH in France and Sweden is ordinary consumer service -
// so this is only ever corroboration, never the sole reason for a verdict.
const ASYMMETRY_RATIO = 0.5;

/**
 * Which vocabularies a PTR record carries.
 * @param {string} hostname Reverse DNS name, or empty when there is none.
 * @returns {('residential'|'datacenter'|'both'|'neither'|'none')}
 */
function classifyPtr(hostname) {
  if (!hostname || typeof hostname !== 'string') return 'none';
  const lower = hostname.toLowerCase();
  const residential = PTR_RESIDENTIAL.some((token) => lower.includes(token));
  const datacenter = PTR_DATACENTER.some((token) => lower.includes(token));
  if (residential && datacenter) return 'both';
  if (residential) return 'residential';
  if (datacenter) return 'datacenter';
  return 'neither';
}

/**
 * True when the operator string names a company that sells hosting.
 * @param {string} isp ip-api `isp`.
 * @param {string} asn ip-api `as`, e.g. "AS24940 Hetzner Online GmbH".
 * @returns {boolean}
 */
function isHostingOperator(isp, asn) {
  const haystack = `${isp || ''} ${asn || ''}`.toLowerCase();
  return HOSTING_OPERATORS.some((operator) => haystack.includes(operator));
}

/**
 * Classify a node's own network from the facts it holds about itself.
 *
 * Every input is optional: a node that could not resolve its PTR, or whose
 * bench figures are missing, still gets an answer from whatever remains - it
 * just gets a less decided one. Passing nothing yields UNKNOWN, which is the
 * correct answer to "I know nothing about this address".
 *
 * @param {object} facts
 * @param {string} [facts.ptr] Reverse DNS for the node's own address.
 * @param {boolean} [facts.hosting] ip-api `hosting`.
 * @param {boolean} [facts.proxy] ip-api `proxy`.
 * @param {boolean} [facts.mobile] ip-api `mobile`.
 * @param {string} [facts.isp] ip-api `isp` - the operator.
 * @param {string} [facts.asn] ip-api `as` - the operator's AS.
 * @param {number} [facts.uploadSpeed] Bench upload, Mbps.
 * @param {number} [facts.downloadSpeed] Bench download, Mbps.
 * @returns {{classification: string, evidenceFor: string[], evidenceAgainst: string[]}}
 */
function classifyNetwork(facts = {}) {
  const {
    ptr, hosting, proxy, mobile, isp, asn, uploadSpeed, downloadSpeed,
  } = facts;

  const evidenceFor = [];
  const evidenceAgainst = [];

  const ptrClass = classifyPtr(ptr);
  if (ptrClass === 'residential') evidenceFor.push(`ptr access-network: ${ptr}`);
  // 'both' is a contradiction on its own: a name carrying hosting vocabulary is
  // not cleared by also carrying access vocabulary.
  if (ptrClass === 'datacenter' || ptrClass === 'both') evidenceAgainst.push(`ptr hosting: ${ptr}`);

  if (mobile === true) evidenceFor.push('ip-api mobile');
  if (hosting === true) evidenceAgainst.push('ip-api hosting');
  if (proxy === true) evidenceAgainst.push('ip-api proxy');

  if (isHostingOperator(isp, asn)) evidenceAgainst.push(`operator sells hosting: ${isp || asn}`);

  // Corroboration only, and deliberately not counted as evidence. A bench figure
  // is a speed test's result, not a property of the link: on its own it would
  // call any node with a lopsided measurement residential, and enforcement would
  // act on an instrument reading. It can support a verdict the real signals
  // already reached; it can never reach one.
  const corroborating = [];
  if (uploadSpeed > 0 && downloadSpeed > 0 && uploadSpeed / downloadSpeed < ASYMMETRY_RATIO) {
    corroborating.push(`asymmetric link ${Math.round(uploadSpeed)}/${Math.round(downloadSpeed)}`);
  }

  let classification = CLASSIFICATION.UNKNOWN;
  if (evidenceFor.length && !evidenceAgainst.length) {
    classification = CLASSIFICATION.RESIDENTIAL;
    evidenceFor.push(...corroborating);
  } else if (evidenceAgainst.length && !evidenceFor.length) {
    classification = CLASSIFICATION.DATACENTER;
  } else if (evidenceFor.length && evidenceAgainst.length) {
    classification = CLASSIFICATION.CONFLICTED;
  }

  return { classification, evidenceFor, evidenceAgainst };
}

module.exports = {
  CLASSIFICATION,
  classifyNetwork,
  classifyPtr,
  isHostingOperator,
  PTR_RESIDENTIAL,
  PTR_DATACENTER,
  HOSTING_OPERATORS,
};
