const crypto = require('crypto');
const { expect } = require('chai');
// The shipped values, not the unit-test mirror.
const config = require('../../ZelBack/config/default');
const appValidator = require('../../ZelBack/src/services/appRequirements/appValidator');
const { verifyEncryptedSpec } = require('../../ZelBack/src/services/utils/enterpriseSpec');
const {
  MAX_APP_COMPONENTS, MAX_APP_NAME_LENGTH, MAX_COMPONENT_NAME_LENGTH, MAX_ENTERPRISE_LENGTH,
} = require('../../ZelBack/src/services/utils/appConstants');

// The largest app message the validator allows, and the frame a node broadcasts it in.
//
// Every string is at its limit and made of a character JSON escapes to six bytes, where no
// character rule applies. Every number is counted at 24 bytes, the longest JSON form of a
// double; the spec itself holds values the validator accepts, so the validator is shown to
// take the spec whose size is counted.

const HEIGHT = 3000000;
const WIDE = '\u0001';
const LONGEST_NUMBER = -1.7976931348623157e+308;

const wide = (n) => WIDE.repeat(n);
const list = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const componentName = (length, i) => `${'c'.repeat(length - 1)}${String.fromCharCode(97 + i)}`;
const PORTS = [31001, 31002, 31003, 31004, 31005];

/** JSON bytes, with every number at its longest. */
const worstBytes = (value) => Buffer.byteLength(
  JSON.stringify(value, (_, v) => (typeof v === 'number' ? LONGEST_NUMBER : v)),
);

function component(nameLength, i, extra) {
  return {
    name: componentName(nameLength, i),
    description: wide(256),
    repotag: wide(200),
    ports: PORTS,
    containerPorts: PORTS,
    environmentParameters: list(20, () => wide(400)),
    commands: list(20, () => wide(400)),
    containerData: wide(200),
    domains: list(5, () => wide(253)),
    ...extra,
    cpu: 1.5,
    ram: 2000,
    hdd: 20,
  };
}

const TIERS = {
  tiered: true,
  cpubasic: 1,
  rambasic: 1000,
  hddbasic: 10,
  cpusuper: 1.5,
  ramsuper: 2000,
  hddsuper: 20,
  cpubamf: 2,
  rambamf: 3000,
  hddbamf: 30,
};

function largestV7() {
  return {
    version: 7,
    name: 'a'.repeat(32),
    description: wide(256),
    owner: `0x${'a'.repeat(40)}`,
    compose: list(MAX_APP_COMPONENTS, (i) => component(32, i, { secrets: wide(15000), repoauth: wide(15000), ...TIERS })),
    instances: config.fluxapps.maximumInstances,
    contacts: list(5, () => wide(75)),
    geolocation: list(10, () => wide(50)),
    expire: config.fluxapps.postPonMaxBlocksAllowance,
    nodes: list(120, () => wide(70)),
    staticip: false,
  };
}

/** A v8 enterprise spec as a node holds it once decrypted. */
function largestV8Decrypted() {
  return {
    version: 8,
    name: 'a'.repeat(MAX_APP_NAME_LENGTH),
    description: wide(256),
    owner: `0x${'a'.repeat(40)}`,
    compose: list(MAX_APP_COMPONENTS, (i) => component(MAX_COMPONENT_NAME_LENGTH, i, { repoauth: wide(15000) })),
    instances: config.fluxapps.maximumInstances,
    contacts: list(5, () => wide(75)),
    geolocation: list(10, () => wide(50)),
    expire: config.fluxapps.postPonMaxBlocksAllowance,
    nodes: list(120, () => wide(70)),
    staticip: false,
    datacenter: false,
    enterprise: 'A'.repeat(MAX_ENTERPRISE_LENGTH),
  };
}

/** The `enterprise` string of a spec: RSA-wrapped key, nonce, ciphertext, tag. */
function encryptedEnterprise({ contacts, compose }) {
  const plaintext = JSON.stringify({ contacts, compose }, (_, v) => (typeof v === 'number' ? LONGEST_NUMBER : v));
  const key = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([crypto.randomBytes(256), nonce, ciphertext, cipher.getAuthTag()]).toString('base64');
}

/** A spec as a client sends it encrypted: compose and contacts only inside `enterprise`. */
function encryptedForm(spec) {
  return {
    ...spec, compose: [], contacts: [], enterprise: encryptedEnterprise(spec),
  };
}

/** A broadcast frame as serialiseAndSignFluxBroadcast sends it, every field at its longest. */
function frameBytes(appSpecifications) {
  return worstBytes({
    version: 1,
    timestamp: 0,
    pubKey: 'a'.repeat(130),
    signature: 'a'.repeat(132),
    data: {
      type: 'fluxappregister',
      version: 1,
      appSpecifications,
      hash: 'a'.repeat(64),
      timestamp: 0,
      signature: 'a'.repeat(132),
      arcaneSender: false,
      clientTag: 'a'.repeat(64),
      clientTagHeight: 0,
      clientTagCap: 0,
    },
  });
}

function validate(spec) {
  appValidator.verifyTypeCorrectnessOfApp(spec);
  appValidator.verifyObjectKeysCorrectnessOfApp(spec);
  appValidator.verifyRestrictionCorrectnessOfApp(spec, HEIGHT);
}

describe('gossip message size tests', () => {
  it('the validator takes the largest v7 spec, and its frame is under the per-message limit', () => {
    const spec = largestV7();
    expect(() => validate(spec)).to.not.throw();
    expect(frameBytes(spec)).to.be.below(config.fluxapps.gossipMessageMaxBytes);
  });

  it('the validator refuses a v7 spec one secret character over the limit', () => {
    const spec = largestV7();
    spec.compose[0].secrets += WIDE;
    expect(() => validate(spec)).to.throw('Maximum length of secrets is 15000');
  });

  it('the validator takes the largest decrypted v8 enterprise spec', () => {
    expect(() => validate(largestV8Decrypted())).to.not.throw();
  });

  it('the largest decrypted v8 enterprise spec encrypts to exactly the enterprise limit', () => {
    expect(encryptedEnterprise(largestV8Decrypted())).to.have.length(MAX_ENTERPRISE_LENGTH);
  });

  it('the largest encrypted v8 spec is taken, and its frame is under the per-message limit', () => {
    const wire = encryptedForm(largestV8Decrypted());
    expect(() => verifyEncryptedSpec(wire)).to.not.throw();
    expect(frameBytes(wire)).to.be.below(config.fluxapps.gossipMessageMaxBytes);
  });

  it('an encrypted spec with an enterprise string one character over the limit is refused', () => {
    const wire = encryptedForm(largestV8Decrypted());
    wire.enterprise += 'A';
    expect(() => verifyEncryptedSpec(wire)).to.throw(`Maximum of ${MAX_ENTERPRISE_LENGTH} characters`);
  });

  it('a sync answer batch holds any message a node takes', () => {
    expect(config.fluxapps.syncAnswerBatchBytes).to.be.at.least(config.fluxapps.gossipMessageMaxBytes);
    expect(config.fluxapps.wsMaxPayloadBytes).to.be.above(config.fluxapps.syncAnswerBatchBytes);
  });
});
