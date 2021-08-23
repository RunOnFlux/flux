import control from './daemon/control'
import fluxnode from './daemon/fluxnode'
import benchmarks from './daemon/benchmarks'
import blockchain from './daemon/blockchain'
import mining from './daemon/mining'
import network from './daemon/network'
import transactions from './daemon/transactions'
import util from './daemon/util'
import wallet from './daemon/wallet'

export default [
  {
    title: 'Daemon',
    icon: 'bolt',
    spacing: true,
    children: [
      ...control,
      ...fluxnode,
      ...benchmarks,
      ...blockchain,
      ...mining,
      ...network,
      ...transactions,
      ...util,
      ...wallet,
      {
        title: 'Debug',
        icon: 'bug',
        route: 'daemon-debug',
        id: 'daemon-debug',
        privilege: ['admin', 'fluxteam'],
      },
    ],
  },
]
