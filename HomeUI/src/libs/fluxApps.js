const fluxSpecifics = {
  cpu: {
    basic: 20, // 10 available for apps
    super: 40, // 30 available for apps
    bamf: 80, // 70 available for apps
  },
  ram: {
    basic: 3000, // 1000 available for apps
    super: 7000, // 5000 available for apps
    bamf: 30000, // available 28000 for apps
  },
  hdd: {
    basic: 50, // 20 for apps
    super: 150, // 120 for apps
    bamf: 600, // 570 for apps
  },
  collateral: {
    basic: 10000,
    super: 25000,
    bamf: 100000,
  },
};

const lockedSystemResources = {
  cpu: 10, // 1 cpu core
  ram: 2000, // 2000mb
  hdd: 30, // 30gb // this value is likely to rise
};

export default {
  fluxSpecifics,
  lockedSystemResources,
  apps: {
    // in flux per month
    price: [{
      height: 0, // height from which price spec is valid
      cpu: 3, // per 0.1 cpu core,
      ram: 1, // per 100mb,
      hdd: 0.5, // per 1gb,
      minPrice: 1,
    },
    {
      height: 983000, // height from which price spec is valid. Counts from when app was registerd on blockchain!
      cpu: 0.3, // per 0.1 cpu core,
      ram: 0.1, // per 100mb,
      hdd: 0.05, // per 1gb,
      minPrice: 0.1,
    }],
    address: 't1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6', // apps registration address
    epochstart: 694000, // apps epoch blockheight start
    portMin: 31000, // originally should have been from 30000 but we got temporary folding there
    portMax: 39999,
  },
  checkHWParameters(appSpecs) {
    // check specs parameters. JS precision
    if ((appSpecs.cpu * 10) % 1 !== 0 || (appSpecs.cpu * 10) > (fluxSpecifics.cpu.bamf - lockedSystemResources.cpu) || appSpecs.cpu < 0.1) {
      return new Error('CPU badly assigned');
    }
    if (appSpecs.ram % 100 !== 0 || appSpecs.ram > (fluxSpecifics.ram.bamf - lockedSystemResources.ram) || appSpecs.ram < 100) {
      return new Error('RAM badly assigned');
    }
    if (appSpecs.hdd % 1 !== 0 || appSpecs.hdd > (fluxSpecifics.hdd.bamf - lockedSystemResources.hdd) || appSpecs.hdd < 1) {
      return new Error('SSD badly assigned');
    }
    if (appSpecs.tiered) {
      if ((appSpecs.cpubasic * 10) % 1 !== 0 || (appSpecs.cpubasic * 10) > (fluxSpecifics.cpu.basic - lockedSystemResources.cpu) || appSpecs.cpubasic < 0.1) {
        return new Error('CPU for Cumulus badly assigned');
      }
      if (appSpecs.rambasic % 100 !== 0 || appSpecs.rambasic > (fluxSpecifics.ram.basic - lockedSystemResources.ram) || appSpecs.rambasic < 100) {
        return new Error('RAM for Cumulus badly assigned');
      }
      if (appSpecs.hddbasic % 1 !== 0 || appSpecs.hddbasic > (fluxSpecifics.hdd.basic - lockedSystemResources.hdd) || appSpecs.hddbasic < 1) {
        return new Error('SSD for Cumulus badly assigned');
      }
      if ((appSpecs.cpusuper * 10) % 1 !== 0 || (appSpecs.cpusuper * 10) > (fluxSpecifics.cpu.super - lockedSystemResources.cpu) || appSpecs.cpusuper < 0.1) {
        return new Error('CPU for Nimbus badly assigned');
      }
      if (appSpecs.ramsuper % 100 !== 0 || appSpecs.ramsuper > (fluxSpecifics.ram.super - lockedSystemResources.ram) || appSpecs.ramsuper < 100) {
        return new Error('RAM for Nimbus badly assigned');
      }
      if (appSpecs.hddsuper % 1 !== 0 || appSpecs.hddsuper > (fluxSpecifics.hdd.super - lockedSystemResources.hdd) || appSpecs.hddsuper < 1) {
        return new Error('SSD for Nimbus badly assigned');
      }
      if ((appSpecs.cpubamf * 10) % 1 !== 0 || (appSpecs.cpubamf * 10) > (fluxSpecifics.cpu.bamf - lockedSystemResources.cpu) || appSpecs.cpubamf < 0.1) {
        return new Error('CPU for Stratus badly assigned');
      }
      if (appSpecs.rambamf % 100 !== 0 || appSpecs.rambamf > (fluxSpecifics.ram.bamf - lockedSystemResources.ram) || appSpecs.rambamf < 100) {
        return new Error('RAM for Stratus badly assigned');
      }
      if (appSpecs.hddbamf % 1 !== 0 || appSpecs.hddbamf > (fluxSpecifics.hdd.bamf - lockedSystemResources.hdd) || appSpecs.hddbamf < 1) {
        return new Error('SSD for Stratus badly assigned');
      }
    }
    return true;
  },
  checkComposeHWParameters(appSpecsComposed) {
    // calculate total HW assigned
    let totalCpu = 0;
    let totalRam = 0;
    let totalHdd = 0;
    let totalCpuBasic = 0;
    let totalCpuSuper = 0;
    let totalCpuBamf = 0;
    let totalRamBasic = 0;
    let totalRamSuper = 0;
    let totalRamBamf = 0;
    let totalHddBasic = 0;
    let totalHddSuper = 0;
    let totalHddBamf = 0;
    const isTiered = appSpecsComposed.compose.find((appComponent) => appComponent.tiered === true);
    appSpecsComposed.compose.forEach((appComponent) => {
      if (isTiered) {
        totalCpuBamf += ((appComponent.cpubamf || appComponent.cpu) * 10);
        totalRamBamf += appComponent.rambamf || appComponent.ram;
        totalHddBamf += appComponent.hddbamf || appComponent.hdd;
        totalCpuSuper += ((appComponent.cpusuper || appComponent.cpu) * 10);
        totalRamSuper += appComponent.ramsuper || appComponent.ram;
        totalHddSuper += appComponent.hddsuper || appComponent.hdd;
        totalCpuBasic += ((appComponent.cpubasic || appComponent.cpu) * 10);
        totalRamBasic += appComponent.rambasic || appComponent.ram;
        totalHddBasic += appComponent.hddbasic || appComponent.hdd;
      } else {
        totalCpu += (appComponent.cpu * 10);
        totalRam += appComponent.ram;
        totalHdd += appComponent.hdd;
      }
    });
    // check specs parameters. JS precision
    if (totalCpu > (fluxSpecifics.cpu.bamf - lockedSystemResources.cpu)) {
      return new Error(`Too much CPU resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRam > (fluxSpecifics.ram.bamf - lockedSystemResources.ram)) {
      return new Error(`Too much RAM rsources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHdd > (fluxSpecifics.hdd.bamf - lockedSystemResources.hdd)) {
      return new Error(`Too much SSD rsources assigned for ${appSpecsComposed.name}`);
    }
    if (isTiered) {
      if (totalCpuBasic > (fluxSpecifics.cpu.basic - lockedSystemResources.cpu)) {
        return new Error(`Too much CPU for Cumulus rsources assigned for ${appSpecsComposed.name}`);
      }
      if (totalRamBasic > (fluxSpecifics.ram.basic - lockedSystemResources.ram)) {
        return new Error(`Too much RAM for Cumulus rsources assigned for ${appSpecsComposed.name}`);
      }
      if (totalHddBasic > (fluxSpecifics.hdd.basic - lockedSystemResources.hdd)) {
        return new Error(`Too much SSD for Cumulus rsources assigned for ${appSpecsComposed.name}`);
      }
      if (totalCpuSuper > (fluxSpecifics.cpu.super - lockedSystemResources.cpu)) {
        return new Error(`Too much CPU for Nimbus rsources assigned for ${appSpecsComposed.name}`);
      }
      if (totalRamSuper > (fluxSpecifics.ram.super - lockedSystemResources.ram)) {
        return new Error(`Too much RAM for Nimbus rsources assigned for ${appSpecsComposed.name}`);
      }
      if (totalHddSuper > (fluxSpecifics.hdd.super - lockedSystemResources.hdd)) {
        return new Error(`Too much SSD for Nimbus rsources assigned for ${appSpecsComposed.name}`);
      }
      if (totalCpuBamf > (fluxSpecifics.cpu.bamf - lockedSystemResources.cpu)) {
        return new Error(`Too much CPU for Stratus rsources assigned for ${appSpecsComposed.name}`);
      }
      if (totalRamBamf > (fluxSpecifics.ram.bamf - lockedSystemResources.ram)) {
        return new Error(`Too much RAM for Stratus rsources assigned for ${appSpecsComposed.name}`);
      }
      if (totalHddBamf > (fluxSpecifics.hdd.bamf - lockedSystemResources.hdd)) {
        return new Error(`Too much SSD for Stratus rsources assigned for ${appSpecsComposed.name}`);
      }
    }
    return true;
  },
};
