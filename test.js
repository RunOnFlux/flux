const runningAppsNames =
    [ 'FoldingAtHome', 'dibi-UND', 'PacMan', 'SuperMario' ];
const installedAppsNames =
    [ 'FoldingAtHome', 'dibi-UND', 'PacMan', 'abc', 'SuperMario' ];
const runningSet = new Set(runningAppsNames);
const abc =
    installedAppsNames.filter((installedApp) => !runningSet.has(installedApp));

console.log(abc);
