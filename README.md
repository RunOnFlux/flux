# zelnoded - ZelNode Daemon
The entrance to the ZelNode network

MongoDB, Express.js, Vue.js, Node.js (MEVN) application

This application communicates locally with ZelCash Daemon (zelcashd), ZelBench Daemon (zelbanchd) and with other ZelNode Daemons (zelnoded). 

With a frontend user interface a ZelNode user can entire access ZelNode network and ZelNode operator can manage his own ZelNode via a web interface instead of logging into node directly and with single button lunch instances, update nodes and much more. 

## Application Overview
#### Backend solution
- Provide communication with zelcashd
- Communication with other zelnodeds
- managing ZelNode applications - smart spawning, distributing workload, terminating depending of application subscription 
- Proividing private API part, and public API part, ZelNode team API part (limited!)
- Listenning and Handling frontend requests
- Requests signing and authenticity verifying
- ...

#### Frontend solution
- ZelNode status information
- ZelNode network information
- ZelCash status information
- ZelCash network information
- Specific application information
- API access
- login into private API part (frontend part)
- login into ZelNode team API part (frontend part)
- Private: Managing of ZelNode
- Private: Managing of ZelCash
- Private: Updating, status information
- ...

This application is open source distributed under GNU AGPLv3


Start both solutions with 

``` bash

npm run zelbackdev
npm run zelfrontdev

```

## ZelFront information

> Frontend interface to interact with ZelNode network

## Build Setup

``` bash

# serve with hot reload at localhost:8080
npm run zelfrontdev

# build for production with minification
npm run zelfrontbuild

# build for production and view the bundle analyzer report
npm run zelfrontbuild --report

# run unit tests
npm run zelfrontunit

# run e2e tests
npm run zelfronte2e

# run all tests
npm run zelfronttest
```

For a detailed explanation on how things work, check out the [guide](http://vuejs-templates.github.io/webpack/) and [docs for vue-loader](http://vuejs.github.io/vue-loader).

## ZelBack information

> Backend interface to interact with ZelNode network
> Default port is 16126
> Communication port with other zelnodes is 16127

## Build Setup

``` bash

# serve with hot reload at localhost:16126
npm run zelbackdev

```