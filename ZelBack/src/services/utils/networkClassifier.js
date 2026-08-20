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
// CONFLICTED is not a rounding error on the way to a binary. Run over the 1,569
// fleet hosts ip-api positively asserts are hosting, across all 29 hosting ASNs
// the fleet uses, this rule puts 1,567 in DATACENTER and 2 in CONFLICTED -
// 213.44.137.57 in Bouygues' consumer space and 212.83.170.245 on Online/
// Scaleway, each carrying an access-network PTR over a hosting flag. Collapsing
// that bucket either way is what would lose them.
//
// It calls none of those 1,569 residential, and that is NOT a measured accuracy:
// `hosting` is itself a contradiction, so on this population RESIDENTIAL is
// unreachable by construction, whatever the other signals say. Quoting it as a
// false-positive rate - as this header did - measures the arithmetic rather than
// the rule.
//
// The rate that means anything is the one at the point of enforcement, and this
// module is not the authority there. It supplies evidence;
// geolocationService.getNetworkClassification lets the published table decide
// and uses evidenceAgainst only to DECLINE a published RESIDENTIAL. Of those
// same 1,569, exactly one carries a published residential verdict -
// 213.44.137.57 - and the veto covers it, so none is enforced against. One
// ledger-level error in 1,569, zero enforced. See
// fluxModels/investigations/PR1784_RESIDENTIAL_DOS_BLAST_RADIUS.md §4 and §9.
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

  // Whether the signals that can CONTRADICT a residential reading were gathered
  // at all. RESIDENTIAL means "something says residential and nothing says
  // otherwise", and the second half is only worth anything if the question was
  // asked. It is not always asked: when ip-api answers 200 with an unusable
  // body, geolocationService falls back to stats.runonflux.io, which carries
  // none of these - it never requests hosting, proxy, mobile or `as` from
  // ip-api in the first place, and its /fluxlocation endpoint projects away
  // everything but location and `org`. On that path all five arrive undefined,
  // an empty evidenceAgainst means nobody looked rather than nothing was found,
  // and a datacentre host reads as enforceably RESIDENTIAL.
  //
  // Inferred from the inputs rather than passed as a flag: a flag can be
  // forgotten by a new caller and would default to whichever answer is
  // convenient, and this survives a geolocation restored from the database,
  // which persists these fields.
  const contradictionSignalsGathered = hosting !== undefined || proxy !== undefined
    || mobile !== undefined || isp !== undefined || asn !== undefined;

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
    // Only reachable when the contradicting signals were actually consulted.
    // Without them this is UNKNOWN, which never enforces - the same answer the
    // module already gives to every other question it cannot settle.
    classification = contradictionSignalsGathered
      ? CLASSIFICATION.RESIDENTIAL
      : CLASSIFICATION.UNKNOWN;
    if (contradictionSignalsGathered) evidenceFor.push(...corroborating);
  } else if (evidenceAgainst.length && !evidenceFor.length) {
    // DATACENTER stands either way: it rests on something found, not on
    // something absent, and it enforces nothing.
    classification = CLASSIFICATION.DATACENTER;
  } else if (evidenceFor.length && evidenceAgainst.length) {
    classification = CLASSIFICATION.CONFLICTED;
  }

  return {
    classification, evidenceFor, evidenceAgainst, contradictionSignalsGathered,
  };
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
