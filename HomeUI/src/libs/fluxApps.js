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
      height: 954000, // height from which price spec is valid. Counts from when app was registerd on blockchain!
      cpu: 0.3, // per 0.1 cpu core,
      ram: 0.1, // per 100mb,
      hdd: 0.05, // per 1gb,
      minPrice: 0.1,
    }],
    address: 't1J1DwsDMWFKxbF4VNHWc1qgbXc5hZeRLRn', // apps registration address
    epochstart: 694000, // apps epoch blockheight start
    portMin: 31000, // originally should have been from 30000 but we got temporary folding there
    portMax: 39999,
  },
  appPricePerMonthMethod(specifications, height) {
    let price;
    const intervals = this.apps.price.filter((i) => i.height <= height);
    const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
    let instancesAdditional = 0;
    if (specifications.instances) {
      // spec of version >= 3
      // specification version 3 is saying. 3 instances are standard, every 3 additional is double the price.
      instancesAdditional = specifications.instances - 3; // has to always be >=0 as of checks before.
    }
    if (specifications.tiered) {
      const cpuTotalCount = specifications.cpubasic + specifications.cpusuper + specifications.cpubamf;
      const cpuPrice = cpuTotalCount * priceSpecifications.cpu * 10; // 0.1 core cost cpu price
      const cpuTotal = cpuPrice / 3;
      const ramTotalCount = specifications.rambasic + specifications.ramsuper + specifications.rambamf;
      const ramPrice = (ramTotalCount * priceSpecifications.ram) / 100;
      const ramTotal = ramPrice / 3;
      const hddTotalCount = specifications.hddbasic + specifications.hddsuper + specifications.hddbamf;
      const hddPrice = hddTotalCount * priceSpecifications.hdd;
      const hddTotal = hddPrice / 3;
      const totalPrice = cpuTotal + ramTotal + hddTotal;
      price = Number(Math.ceil(totalPrice * 100) / 100);
      if (instancesAdditional > 0) {
        const additionalPrice = (price * instancesAdditional) / 3;
        price = (Math.ceil(additionalPrice * 100) + Math.ceil(price * 100)) / 100;
      }
      if (price < priceSpecifications.minPrice) {
        price = priceSpecifications.minPrice;
      }
      return price;
    }
    const cpuTotal = specifications.cpu * priceSpecifications.cpu * 10;
    const ramTotal = (specifications.ram * priceSpecifications.ram) / 100;
    const hddTotal = specifications.hdd * priceSpecifications.hdd;
    const totalPrice = cpuTotal + ramTotal + hddTotal;
    price = Number(Math.ceil(totalPrice * 100) / 100);
    if (instancesAdditional > 0) {
      const additionalPrice = (price * instancesAdditional) / 3;
      price = (Math.ceil(additionalPrice * 100) + Math.ceil(price * 100)) / 100;
    }
    if (price < priceSpecifications.minPrice) {
      price = priceSpecifications.minPrice;
    }
    return price;
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
};
