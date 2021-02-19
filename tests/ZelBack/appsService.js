process.env.NODE_CONFIG_DIR = `${process.cwd()}/ZelBack/config/`;
const appService = require("../../ZelBack/src/services/appsService");
const chai = require('chai');
const expect = chai.expect;

// describe('checkAndRequestApp', () => {
//   it('signs checks and requests app properly', async () => {
//     const hash = 'abc';
//     const txid = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
//     const height = 33;
//     valueSat = 33 * 1e8;
//     const abc = await appService.checkAndRequestApp(hash, txid, height, valueSat);
//     expect(abc).to.equal('abc');
//   });
// });

describe('checkHWParameters', () => {
  it('Verifies HW specs are correct', () => {
    const fluxAppSpecs = {
      "version": 2,
      "name": "FoldingAtHome",
      "description": "Folding @ Home is cool :)",
      "repotag": "yurinnick/folding-at-home:latest",
      "owner": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
      "ports": [30001],
      "containerPorts": [7396],
      "domains": [''],
      "enviromentParameters": [
        "USER=foldingUser",
        "TEAM=262156",
        "ENABLE_GPU=false",
        "ENABLE_SMP=true"
      ],
      "commands": [
        "--allow",
        "0/0",
        "--web-allow",
        "0/0"
      ],
      "containerData": "/config",
      "cpu": 0.5,
      "ram": 500,
      "hdd": 5,
      "tiered": true,
      "cpubasic": 0.5,
      "cpusuper": 1,
      "cpubamf": 2,
      "rambasic": 500,
      "ramsuper": 1000,
      "rambamf": 2000,
      "hddbasic": 5,
      "hddsuper": 5,
      "hddbamf": 5
    };
    expect(appService.checkHWParameters(fluxAppSpecs)).to.be.equal(true);
  });

  it('Verifies HW specs are badly asssigned', () => {
    const fluxAppSpecs = {
      "version": 2,
      "name": "FoldingAtHome",
      "description": "Folding @ Home is cool :)",
      "repotag": "yurinnick/folding-at-home:latest",
      "owner": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
      "ports": [30001],
      "containerPorts": [7396],
      "domains": [''],
      "enviromentParameters": [
        "USER=foldingUser",
        "TEAM=262156",
        "ENABLE_GPU=false",
        "ENABLE_SMP=true"
      ],
      "commands": [
        "--allow",
        "0/0",
        "--web-allow",
        "0/0"
      ],
      "containerData": "/config",
      "cpu": 0.5,
      "ram": 'badly assigned',
      "hdd": 5,
      "tiered": true,
      "cpubasic": 0.5,
      "cpusuper": 1,
      "cpubamf": 2,
      "rambasic": 500,
      "ramsuper": 1000,
      "rambamf": 2000,
      "hddbasic": 5,
      "hddsuper": 5,
      "hddbamf": 5
    };
    expect(appService.checkHWParameters(fluxAppSpecs)).to.be.an('error');
  });

  it('Verifies HW specs are missing', () => {
    const fluxAppSpecs = {
      "version": 2,
      "name": "FoldingAtHome",
      "description": "Folding @ Home is cool :)",
      "repotag": "yurinnick/folding-at-home:latest",
      "owner": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
      "ports": [30001],
      "containerPorts": [7396],
      "domains": [''],
      "enviromentParameters": [
        "USER=foldingUser",
        "TEAM=262156",
        "ENABLE_GPU=false",
        "ENABLE_SMP=true",
      ],
      "commands": [
        "--allow",
        "0/0",
        "--web-allow",
        "0/0"
      ],
      "containerData": "/config",
      "cpu": null,
      "ram": 4000,
      "hdd": 5,
      "tiered": true,
      "cpubasic": 0.5,
      "cpusuper": 1,
      "cpubamf": 2,
      "rambasic": 500,
      "ramsuper": 1000,
      "rambamf": 2000,
      "hddbasic": 5,
      "hddsuper": 5,
      "hddbamf": 21
    };
    const hwSpecs = appService.checkHWParameters(fluxAppSpecs);
    expect(hwSpecs).to.be.an('error');
  });

  it('Verifies repository exists or is not correct', async () => {
    const fluxAppSpecs = {
      "repotag": "yurinnick/folding-at-home:latest",
      "repotagB": "yurinnick/folding-at-home:latestaaa",
    };
    const repA = await appService.verifyRepository(fluxAppSpecs.repotag);
    expect(repA).to.be.equal(true);
    const repB = await appService.verifyRepository(fluxAppSpecs.repotagB).catch((error) => {
      expect(error.message).to.be.equal('Repository is not in valid format namespace/repository:tag')
    });
    expect(repB).to.be.equal(undefined)
    // expect(appService.verifyAppSpecifications(fluxAppSpecs)).to.not.throw();
  });

  it('Message Hash is correctly calculated', async () => {
    const fluxAppSpecs = {
      "version": 2,
      "name": "FoldingAtHome",
      "description": "Folding @ Home is cool :)",
      "repotag": "yurinnick/folding-at-home:latest",
      "owner": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
      "ports": [30001],
      "containerPorts": [7396],
      "domains": [''],
      "enviromentParameters": [
        "USER=foldingUser",
        "TEAM=262156",
        "ENABLE_GPU=false",
        "ENABLE_SMP=true"
      ],
      "commands": [
        "--allow",
        "0/0",
        "--web-allow",
        "0/0"
      ],
      "containerData": "/config",
      "cpu": 0.5,
      "ram": 500,
      "hdd": 5,
      "tiered": true,
      "cpubasic": 0.5,
      "cpusuper": 1,
      "cpubamf": 2,
      "rambasic": 500,
      "ramsuper": 1000,
      "rambamf": 2000,
      "hddbasic": 5,
      "hddsuper": 5,
      "hddbamf": 5
    };
    const type = 'fluxappregister';
    const version = 1;
    const timestamp = 1592988806887
    const signature = 'H7AP+VrFUTrmi+DqG8x0nllBFXB+oD09AkSE/JEpemeOTzMglftjTtPaEY3rMW/FUezEiad0WZNgxiInFrUn6S8=';
    const messageHash = 'c509eae87618e0c4c40106d3c515923d7611070bcafad261de9520238617c972'
    const message = type + version + JSON.stringify(fluxAppSpecs) + timestamp + signature;
    expect(await appService.messageHash(message)).to.be.equal(messageHash);
  });

  it('Message Hash is correctly verified', async () => {
    const fluxAppSpecs = {
      "version": 2,
      "name": "FoldingAtHome",
      "description": "Folding @ Home is cool :)",
      "repotag": "yurinnick/folding-at-home:latest",
      "owner": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
      "ports": [30001],
      "containerPorts": [7396],
      "domains": [''],
      "enviromentParameters": [
        "USER=foldingUser",
        "TEAM=262156",
        "ENABLE_GPU=false",
        "ENABLE_SMP=true"
      ],
      "commands": [
        "--allow",
        "0/0",
        "--web-allow",
        "0/0"
      ],
      "containerData": "/config",
      "cpu": 0.5,
      "ram": 500,
      "hdd": 5,
      "tiered": true,
      "cpubasic": 0.5,
      "cpusuper": 1,
      "cpubamf": 2,
      "rambasic": 500,
      "ramsuper": 1000,
      "rambamf": 2000,
      "hddbasic": 5,
      "hddsuper": 5,
      "hddbamf": 5
    };
    const type = 'fluxappregister';
    const version = 1;
    const timestamp = 1592988806887
    const signature = 'H7AP+VrFUTrmi+DqG8x0nllBFXB+oD09AkSE/JEpemeOTzMglftjTtPaEY3rMW/FUezEiad0WZNgxiInFrUn6S8=';
    const messageHash = 'c509eae87618e0c4c40106d3c515923d7611070bcafad261de9520238617c972';
    const message =  {
      type, 
      version,
      hash: messageHash,
      zelAppSpecifications: fluxAppSpecs,
      timestamp,
      signature,
    }
    expect(await appService.verifyAppHash(message)).to.be.equal(true);
  });

  it('Message is correctly signed', async () => {
    const fluxAppSpecs = {
      "version": 2,
      "name": "FoldingAtHome",
      "description": "Folding @ Home is cool :)",
      "repotag": "yurinnick/folding-at-home:latest",
      "owner": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
      "ports": [30001],
      "containerPorts": [7396],
      "domains": [''],
      "enviromentParameters": [
        "USER=foldingUser",
        "TEAM=262156",
        "ENABLE_GPU=false",
        "ENABLE_SMP=true"
      ],
      "commands": [
        "--allow",
        "0/0",
        "--web-allow",
        "0/0"
      ],
      "containerData": "/config",
      "cpu": 0.5,
      "ram": 500,
      "hdd": 5,
      "tiered": true,
      "cpubasic": 0.5,
      "cpusuper": 1,
      "cpubamf": 2,
      "rambasic": 500,
      "ramsuper": 1000,
      "rambamf": 2000,
      "hddbasic": 5,
      "hddsuper": 5,
      "hddbamf": 5
    };
    const type = 'fluxappregister';
    const version = 1;
    const timestamp = 1592988806887
    const messageToVerify = type + version + JSON.stringify(fluxAppSpecs) + timestamp;
    console.log(messageToVerify);
    const signature = 'H7AP+VrFUTrmi+DqG8x0nllBFXB+oD09AkSE/JEpemeOTzMglftjTtPaEY3rMW/FUezEiad0WZNgxiInFrUn6S8=';
    expect(await appService.verifyAppMessageSignature(type, version, fluxAppSpecs, timestamp, signature)).to.be.equal(true);
  });
});
