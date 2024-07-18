const standard = `rpcuser=testuser
rpcpassword=testpassword12345
rpcallowip=127.0.0.1
rpcallowip=172.18.0.1
rpcport=16124
port=16125
zelnode=1
zelnodeprivkey=testprivatekey
zelnodeoutpoint=testoutpoint
zelnodeindex=0
server=1
daemon=1
txindex=1
addressindex=1
timestampindex=1
spentindex=1
insightexplorer=1
experimentalfeatures=1
listen=1
externalip=1.2.3.4
bind=0.0.0.0
addnode=80.211.207.17
addnode=95.217.12.176
addnode=89.58.3.209
addnode=161.97.85.103
addnode=194.163.176.185
addnode=explorer.flux.zelcore.io
addnode=explorer.runonflux.io
addnode=explorer.zelcash.online
addnode=blockbook.runonflux.io
addnode=202.61.202.21
addnode=89.58.40.172
addnode=37.120.176.206
addnode=66.119.15.83
addnode=66.94.118.208
addnode=99.48.162.169
addnode=97.120.40.143
addnode=99.48.162.167
addnode=108.30.50.162
addnode=154.12.242.89
addnode=67.43.96.139
addnode=66.94.107.219
addnode=66.94.110.117
addnode=154.12.225.203
addnode=176.9.72.41
addnode=65.108.198.119
addnode=65.108.200.110
addnode=46.38.251.110
addnode=95.214.55.47
addnode=202.61.236.202
addnode=65.108.141.153
addnode=178.170.46.91
addnode=66.119.15.64
addnode=65.108.46.178
addnode=94.130.220.41
addnode=178.170.48.110
addnode=78.35.147.57
addnode=66.119.15.101
addnode=66.119.15.96
addnode=38.88.125.25
addnode=66.119.15.110
addnode=103.13.31.149
addnode=212.80.212.238
addnode=212.80.213.172
addnode=212.80.212.228
addnode=121.112.224.186
addnode=114.181.141.16
addnode=167.179.115.100
addnode=153.226.219.80
addnode=24.79.73.50
addnode=76.68.219.102
addnode=70.52.20.8
addnode=184.145.181.147
addnode=68.150.72.135
addnode=198.27.83.181
addnode=167.114.82.63
addnode=24.76.166.6
addnode=173.33.170.150
addnode=99.231.229.245
addnode=70.82.102.140
addnode=192.95.30.188
addnode=75.158.245.77
addnode=142.113.239.49
addnode=66.70.176.241
addnode=174.93.146.224
addnode=216.232.124.38
addnode=207.34.248.197
addnode=76.68.219.102
addnode=149.56.25.82
addnode=74.57.74.166
addnode=142.169.180.47
addnode=70.67.210.148
addnode=86.5.78.14
addnode=87.244.105.94
addnode=86.132.192.193
addnode=86.27.168.85
addnode=86.31.168.107
addnode=84.71.79.220
addnode=154.57.235.104
addnode=86.13.102.145
addnode=86.31.168.107
addnode=86.13.68.100
addnode=151.225.136.163
addnode=5.45.110.123
addnode=45.142.178.251
addnode=89.58.5.234
addnode=45.136.30.81
addnode=202.61.255.238
addnode=89.58.7.2
addnode=89.58.36.46
addnode=89.58.32.76
addnode=89.58.39.81
addnode=89.58.39.153
addnode=202.61.244.71
addnode=89.58.37.172
addnode=89.58.36.118
addnode=31.145.161.44
addnode=217.131.61.221
addnode=80.28.72.254
addnode=85.49.210.36
addnode=84.77.69.203
addnode=51.38.1.195
addnode=51.38.1.194
maxconnections=256
`;

const standardParsed = {
  rpcuser: 'testuser',
  rpcpassword: 'testpassword12345',
  rpcallowip: ['127.0.0.1', '172.18.0.1'],
  rpcport: '16124',
  port: '16125',
  zelnode: '1',
  zelnodeprivkey: 'testprivatekey',
  zelnodeoutpoint: 'testoutpoint',
  zelnodeindex: '0',
  server: '1',
  daemon: '1',
  txindex: '1',
  addressindex: '1',
  timestampindex: '1',
  spentindex: '1',
  insightexplorer: '1',
  experimentalfeatures: '1',
  listen: '1',
  externalip: '1.2.3.4',
  bind: '0.0.0.0',
  addnode: [
    '80.211.207.17',
    '95.217.12.176',
    '89.58.3.209',
    '161.97.85.103',
    '194.163.176.185',
    'explorer.flux.zelcore.io',
    'explorer.runonflux.io',
    'explorer.zelcash.online',
    'blockbook.runonflux.io',
    '202.61.202.21',
    '89.58.40.172',
    '37.120.176.206',
    '66.119.15.83',
    '66.94.118.208',
    '99.48.162.169',
    '97.120.40.143',
    '99.48.162.167',
    '108.30.50.162',
    '154.12.242.89',
    '67.43.96.139',
    '66.94.107.219',
    '66.94.110.117',
    '154.12.225.203',
    '176.9.72.41',
    '65.108.198.119',
    '65.108.200.110',
    '46.38.251.110',
    '95.214.55.47',
    '202.61.236.202',
    '65.108.141.153',
    '178.170.46.91',
    '66.119.15.64',
    '65.108.46.178',
    '94.130.220.41',
    '178.170.48.110',
    '78.35.147.57',
    '66.119.15.101',
    '66.119.15.96',
    '38.88.125.25',
    '66.119.15.110',
    '103.13.31.149',
    '212.80.212.238',
    '212.80.213.172',
    '212.80.212.228',
    '121.112.224.186',
    '114.181.141.16',
    '167.179.115.100',
    '153.226.219.80',
    '24.79.73.50',
    '76.68.219.102',
    '70.52.20.8',
    '184.145.181.147',
    '68.150.72.135',
    '198.27.83.181',
    '167.114.82.63',
    '24.76.166.6',
    '173.33.170.150',
    '99.231.229.245',
    '70.82.102.140',
    '192.95.30.188',
    '75.158.245.77',
    '142.113.239.49',
    '66.70.176.241',
    '174.93.146.224',
    '216.232.124.38',
    '207.34.248.197',
    '76.68.219.102',
    '149.56.25.82',
    '74.57.74.166',
    '142.169.180.47',
    '70.67.210.148',
    '86.5.78.14',
    '87.244.105.94',
    '86.132.192.193',
    '86.27.168.85',
    '86.31.168.107',
    '84.71.79.220',
    '154.57.235.104',
    '86.13.102.145',
    '86.31.168.107',
    '86.13.68.100',
    '151.225.136.163',
    '5.45.110.123',
    '45.142.178.251',
    '89.58.5.234',
    '45.136.30.81',
    '202.61.255.238',
    '89.58.7.2',
    '89.58.36.46',
    '89.58.32.76',
    '89.58.39.81',
    '89.58.39.153',
    '202.61.244.71',
    '89.58.37.172',
    '89.58.36.118',
    '31.145.161.44',
    '217.131.61.221',
    '80.28.72.254',
    '85.49.210.36',
    '84.77.69.203',
    '51.38.1.195',
    '51.38.1.194',
  ],
  maxconnections: '256',
};

const withComments = `rpcuser=testuser
rpcpassword=testpassword12345
rpcallowip=127.0.0.1
rpcallowip=172.18.0.1
rpcport=16124
port=16125 # this is a comment
zelnode=1
zelnodeprivkey=testprivatekey
zelnodeoutpoint=testoutpoint
zelnodeindex=0
server=1
# heres another comment
daemon=1
txindex=1
addressindex=1
timestampindex=1
spentindex=1
#and again
insightexplorer=1
experimentalfeatures=1#nospaceshere
listen=1
externalip=1.2.3.4
bind=0.0.0.0
addnode=80.211.207.17
addnode=95.217.12.176
maxconnections=256
`;

const withCommentsParsed = {
  rpcuser: 'testuser',
  rpcpassword: 'testpassword12345',
  rpcallowip: ['127.0.0.1', '172.18.0.1'],
  rpcport: '16124',
  port: '16125 # this is a comment',
  zelnode: '1',
  zelnodeprivkey: 'testprivatekey',
  zelnodeoutpoint: 'testoutpoint',
  zelnodeindex: '0',
  server: '1',
  '# heres another comment': undefined,
  daemon: '1',
  txindex: '1',
  addressindex: '1',
  timestampindex: '1',
  spentindex: '1',
  '#and again': undefined,
  insightexplorer: '1',
  experimentalfeatures: '1#nospaceshere',
  listen: '1',
  externalip: '1.2.3.4',
  bind: '0.0.0.0',
  addnode: ['80.211.207.17', '95.217.12.176'],
  maxconnections: '256',
};

const withWhitespace = `rpcuser=testuser
rpcpassword=testpassword12345
rpcallowip=127.0.0.1
rpcallowip=172.18.0.1
rpcport=16124
port=16125

zelnode=1
zelnodeprivkey=testprivatekey
zelnodeoutpoint=testoutpoint
zelnodeindex=0
server=1
daemon=1
txindex=1
addressindex=1
timestampindex=1


spentindex=1

insightexplorer=1
experimentalfeatures=1
listen=1
externalip=1.2.3.4
bind=0.0.0.0
addnode=80.211.207.17
addnode=95.217.12.176
maxconnections=256
`;

const withWhitespaceRemoved = `rpcuser=testuser
rpcpassword=testpassword12345
rpcallowip=127.0.0.1
rpcallowip=172.18.0.1
rpcport=16124
port=16125
zelnode=1
zelnodeprivkey=testprivatekey
zelnodeoutpoint=testoutpoint
zelnodeindex=0
server=1
daemon=1
txindex=1
addressindex=1
timestampindex=1
spentindex=1
insightexplorer=1
experimentalfeatures=1
listen=1
externalip=1.2.3.4
bind=0.0.0.0
addnode=80.211.207.17
addnode=95.217.12.176
maxconnections=256
`;

const withWhitespaceParsed = {
  rpcuser: 'testuser',
  rpcpassword: 'testpassword12345',
  rpcallowip: ['127.0.0.1', '172.18.0.1'],
  rpcport: '16124',
  port: '16125',
  zelnode: '1',
  zelnodeprivkey: 'testprivatekey',
  zelnodeoutpoint: 'testoutpoint',
  zelnodeindex: '0',
  server: '1',
  daemon: '1',
  txindex: '1',
  addressindex: '1',
  timestampindex: '1',
  spentindex: '1',
  insightexplorer: '1',
  experimentalfeatures: '1',
  listen: '1',
  externalip: '1.2.3.4',
  bind: '0.0.0.0',
  addnode: ['80.211.207.17', '95.217.12.176'],
  maxconnections: '256',
};

const withOptionsAdded = `rpcuser=testuser
rpcpassword=testpassword12345
rpcallowip=127.0.0.1
rpcallowip=172.18.0.1
rpcport=16124
port=16125
zelnode=1
zelnodeprivkey=testprivatekey
zelnodeoutpoint=testoutpoint
zelnodeindex=0
server=1
daemon=1
txindex=1
addressindex=1
timestampindex=1
spentindex=1
insightexplorer=1
experimentalfeatures=1
listen=1
externalip=1.2.3.4
bind=0.0.0.0
addnode=80.211.207.17
addnode=95.217.12.176
maxconnections=256
zmqpubhashtx=tcp://127.0.0.1:16126
zmqpubhashblock=tcp://127.0.0.1:16126
zmqpubrawblock=tcp://127.0.0.1:16126
zmqpubrawtx=tcp://127.0.0.1:16126
zmqpubsequence=tcp://127.0.0.1:16126
`;

const withOptionsUpdated = `rpcuser=testuser
rpcpassword=testpassword12345
rpcallowip=127.0.0.1
rpcallowip=172.18.0.1
rpcport=16124
port=16125
zelnode=1
zelnodeprivkey=testprivatekey
zelnodeoutpoint=testoutpoint
zelnodeindex=0
server=1
daemon=1
txindex=1
addressindex=1
timestampindex=1
spentindex=1
insightexplorer=1
experimentalfeatures=1
listen=1
externalip=1.2.3.4
bind=0.0.0.0
addnode=80.211.207.17
addnode=95.217.12.176
maxconnections=256
zmqpubhashtx=tcp://127.0.0.1:33333
zmqpubhashblock=tcp://127.0.0.1:33333
zmqpubrawblock=tcp://127.0.0.1:33333
zmqpubrawtx=tcp://127.0.0.1:33333
zmqpubsequence=tcp://127.0.0.1:33333
`;

const withMultiValueOptionsAdded = `rpcuser=testuser
rpcpassword=testpassword12345
rpcallowip=127.0.0.1
rpcallowip=172.18.0.1
rpcport=16124
port=16125
zelnode=1
zelnodeprivkey=testprivatekey
zelnodeoutpoint=testoutpoint
zelnodeindex=0
server=1
daemon=1
txindex=1
addressindex=1
timestampindex=1
spentindex=1
insightexplorer=1
experimentalfeatures=1
listen=1
externalip=1.2.3.4
bind=0.0.0.0
addnode=80.211.207.17
addnode=95.217.12.176
maxconnections=256
testOption=a
testOption=b
testOption=c
testOption=d
`;

const withMultivalueOptionOverwritten = `rpcuser=testuser
rpcpassword=testpassword12345
rpcallowip=127.0.0.1
rpcallowip=172.18.0.1
rpcport=16124
port=16125
zelnode=1
zelnodeprivkey=testprivatekey
zelnodeoutpoint=testoutpoint
zelnodeindex=0
server=1
daemon=1
txindex=1
addressindex=1
timestampindex=1
spentindex=1
insightexplorer=1
experimentalfeatures=1
listen=1
externalip=1.2.3.4
bind=0.0.0.0
addnode=1.2.3.4:1111
maxconnections=256
`;

const withArrayItemAdded = `rpcuser=testuser
rpcpassword=testpassword12345
rpcallowip=127.0.0.1
rpcallowip=172.18.0.1
rpcport=16124
port=16125
zelnode=1
zelnodeprivkey=testprivatekey
zelnodeoutpoint=testoutpoint
zelnodeindex=0
server=1
daemon=1
txindex=1
addressindex=1
timestampindex=1
spentindex=1
insightexplorer=1
experimentalfeatures=1
listen=1
externalip=1.2.3.4
bind=0.0.0.0
addnode=80.211.207.17
addnode=95.217.12.176
addnode=89.58.3.209
addnode=161.97.85.103
addnode=194.163.176.185
addnode=explorer.flux.zelcore.io
addnode=explorer.runonflux.io
addnode=explorer.zelcash.online
addnode=blockbook.runonflux.io
addnode=202.61.202.21
addnode=89.58.40.172
addnode=37.120.176.206
addnode=66.119.15.83
addnode=66.94.118.208
addnode=99.48.162.169
addnode=97.120.40.143
addnode=99.48.162.167
addnode=108.30.50.162
addnode=154.12.242.89
addnode=67.43.96.139
addnode=66.94.107.219
addnode=66.94.110.117
addnode=154.12.225.203
addnode=176.9.72.41
addnode=65.108.198.119
addnode=65.108.200.110
addnode=46.38.251.110
addnode=95.214.55.47
addnode=202.61.236.202
addnode=65.108.141.153
addnode=178.170.46.91
addnode=66.119.15.64
addnode=65.108.46.178
addnode=94.130.220.41
addnode=178.170.48.110
addnode=78.35.147.57
addnode=66.119.15.101
addnode=66.119.15.96
addnode=38.88.125.25
addnode=66.119.15.110
addnode=103.13.31.149
addnode=212.80.212.238
addnode=212.80.213.172
addnode=212.80.212.228
addnode=121.112.224.186
addnode=114.181.141.16
addnode=167.179.115.100
addnode=153.226.219.80
addnode=24.79.73.50
addnode=76.68.219.102
addnode=70.52.20.8
addnode=184.145.181.147
addnode=68.150.72.135
addnode=198.27.83.181
addnode=167.114.82.63
addnode=24.76.166.6
addnode=173.33.170.150
addnode=99.231.229.245
addnode=70.82.102.140
addnode=192.95.30.188
addnode=75.158.245.77
addnode=142.113.239.49
addnode=66.70.176.241
addnode=174.93.146.224
addnode=216.232.124.38
addnode=207.34.248.197
addnode=76.68.219.102
addnode=149.56.25.82
addnode=74.57.74.166
addnode=142.169.180.47
addnode=70.67.210.148
addnode=86.5.78.14
addnode=87.244.105.94
addnode=86.132.192.193
addnode=86.27.168.85
addnode=86.31.168.107
addnode=84.71.79.220
addnode=154.57.235.104
addnode=86.13.102.145
addnode=86.31.168.107
addnode=86.13.68.100
addnode=151.225.136.163
addnode=5.45.110.123
addnode=45.142.178.251
addnode=89.58.5.234
addnode=45.136.30.81
addnode=202.61.255.238
addnode=89.58.7.2
addnode=89.58.36.46
addnode=89.58.32.76
addnode=89.58.39.81
addnode=89.58.39.153
addnode=202.61.244.71
addnode=89.58.37.172
addnode=89.58.36.118
addnode=31.145.161.44
addnode=217.131.61.221
addnode=80.28.72.254
addnode=85.49.210.36
addnode=84.77.69.203
addnode=51.38.1.195
addnode=51.38.1.194
addnode=7.7.7.7
maxconnections=256
`;

module.exports = {
  standard,
  standardParsed,
  withComments,
  withCommentsParsed,
  withWhitespace,
  withWhitespaceRemoved,
  withWhitespaceParsed,
  withOptionsAdded,
  withOptionsUpdated,
  withMultiValueOptionsAdded,
  withMultivalueOptionOverwritten,
  withArrayItemAdded,
};
