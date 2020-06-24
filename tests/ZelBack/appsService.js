process.env.NODE_CONFIG_DIR = `${process.cwd()}/ZelBack/config/`;
const appService = require("../../ZelBack/src/services/zelappsService");
const chai = require('chai');
const expect = chai.expect;

// describe('checkAndRequestZelApp', () => {
//   it('signs checks and requests app properly', async () => {
//     const zelapphash = 'abc';
//     const txid = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
//     const height = 33;
//     valueSat = 33 * 1e8;
//     const abc = await appService.checkAndRequestZelApp(zelapphash, txid, height, valueSat);
//     expect(abc).to.equal('abc');
//   });
// });

describe('checkHWParameters', () => {
  it('Verifies HW specs are correct', () => {
    const zelAppSpecs = {
      "version": 1,
      "name": "FoldingAtHome",
      "description": "Folding @ Home is cool :)",
      "repotag": "yurinnick/folding-at-home:latest",
      "owner": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
      "port": 30001,
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
      "containerPort": 7396,
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
    expect(appService.checkHWParameters(zelAppSpecs)).to.be.equal(true);
  });

  it('Verifies HW specs are badly asssigned', () => {
    const zelAppSpecs = {
      "version": 1,
      "name": "FoldingAtHome",
      "description": "Folding @ Home is cool :)",
      "repotag": "yurinnick/folding-at-home:latest",
      "owner": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
      "port": 30001,
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
      "containerPort": 7396,
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
    expect(appService.checkHWParameters(zelAppSpecs)).to.be.an('error');
  });

  it('Verifies HW specs are missing', () => {
    const zelAppSpecs = {
      "version": 1,
      "name": "FoldingAtHome",
      "description": "Folding @ Home is cool :)",
      "repotag": "yurinnick/folding-at-home:latest",
      "owner": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
      "port": 30001,
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
      "containerPort": 7396,
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
    const hwSpecs = appService.checkHWParameters(zelAppSpecs);
    expect(hwSpecs).to.be.an('error');
  });

  it('Verifies repository exists or is not correct', async () => {
    const zelAppSpecs = {
      "repotag": "yurinnick/folding-at-home:latest",
      "repotagB": "yurinnick/folding-at-home:latestaaa",
    };
    const type = 'zelappregister';
    const version = 1;
    const timestamp = 1592988806887
    const dataToSign = 'zelappregister1{"version":1,"name":"FoldingAtHome","description":"Folding @ Home is cool :)","repotag":"yurinnick/folding-at-home:latest","owner":"1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC","port":30001,"enviromentParameters":["USER=foldingUser","TEAM=262156","ENABLE_GPU=false","ENABLE_SMP=true"],"commands":["--allow","0/0","--web-allow","0/0"],"containerPort":7396,"containerData":"/config","cpu":0.5,"ram":500,"hdd":5,"tiered":true,"cpubasic":0.5,"cpusuper":1,"cpubamf":2,"rambasic":500,"ramsuper":1000,"rambamf":2000,"hddbasic":5,"hddsuper":5,"hddbamf":5}1592988806887';
    const signature = 'HxgaYStMPP/Als06OmDJltVyp/7bcV8mEjwXictlgZKnTQJoxf0eIA/np2q6OSrkQx6IB1ksiS+71uYEOIHrFvw=';
    const repA = await appService.verifyRepository(zelAppSpecs.repotag);
    expect(repA).to.be.equal(true);
    const repB = await appService.verifyRepository(zelAppSpecs.repotagB).catch((error) => {
      expect(error.message).to.be.equal('Repository is not in valid format namespace/repository:tag')
    });
    expect(repB).to.be.equal(undefined)
    // expect(appService.verifyZelAppSpecifications(zelAppSpecs)).to.not.throw();
  });

  it('Message Hash is correctly calculated', async () => {
    const zelAppSpecs = {
      "version": 1,
      "name": "FoldingAtHome",
      "description": "Folding @ Home is cool :)",
      "repotag": "yurinnick/folding-at-home:latest",
      "owner": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
      "port": 30001,
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
      "containerPort": 7396,
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
    const type = 'zelappregister';
    const version = 1;
    const timestamp = 1592988806887
    const signature = 'HxgaYStMPP/Als06OmDJltVyp/7bcV8mEjwXictlgZKnTQJoxf0eIA/np2q6OSrkQx6IB1ksiS+71uYEOIHrFvw=';
    const messageHash = 'd77a4ac4580391fb1122e43cc32d5899eeb1ca655f6bf11d0ef2639a4cf2cd94'
    const message = type + version + JSON.stringify(zelAppSpecs) + timestamp + signature;
    expect(await appService.messageHash(message)).to.be.equal(messageHash);
  });

  it('Message Hash is correctly verified', async () => {
    const zelAppSpecs = {
      "version": 1,
      "name": "FoldingAtHome",
      "description": "Folding @ Home is cool :)",
      "repotag": "yurinnick/folding-at-home:latest",
      "owner": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
      "port": 30001,
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
      "containerPort": 7396,
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
    const type = 'zelappregister';
    const version = 1;
    const timestamp = 1592988806887
    const signature = 'HxgaYStMPP/Als06OmDJltVyp/7bcV8mEjwXictlgZKnTQJoxf0eIA/np2q6OSrkQx6IB1ksiS+71uYEOIHrFvw=';
    const messageHash = 'd77a4ac4580391fb1122e43cc32d5899eeb1ca655f6bf11d0ef2639a4cf2cd94';
    const message =  {
      type, 
      version,
      hash: messageHash,
      zelAppSpecifications: zelAppSpecs,
      timestamp,
      signature,
    }
    expect(await appService.verifyZelAppHash(message)).to.be.equal(true);
  });

  it('Message is correctly signed', async () => {
    const zelAppSpecs = {
      "version": 1,
      "name": "FoldingAtHome",
      "description": "Folding @ Home is cool :)",
      "repotag": "yurinnick/folding-at-home:latest",
      "owner": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
      "port": 30001,
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
      "containerPort": 7396,
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
    const type = 'zelappregister';
    const version = 1;
    const timestamp = 1592988806887
    const signature = 'HxgaYStMPP/Als06OmDJltVyp/7bcV8mEjwXictlgZKnTQJoxf0eIA/np2q6OSrkQx6IB1ksiS+71uYEOIHrFvw=';
    expect(await appService.verifyZelAppMessageSignature(type, version, zelAppSpecs, timestamp, signature)).to.be.equal(true);
  });
});
