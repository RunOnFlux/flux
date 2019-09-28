# zelnoded - ZelNode Daemon
The entrance to the ZelNode network

Requires reasonably new version of Node.js (npm) and MongoDB

MongoDB, Express.js, Vue.js, Node.js (MEVN) application

This application communicates locally with ZelCash Daemon (zelcashd), ZelBench Daemon (zelbanchd) and with other ZelNode Daemons (zelnoded). 

With a frontend user interface a ZelNode user can entire access ZelNode network and ZelNode operator can manage his own ZelNode via a web interface instead of logging into node directly and with single button lunch instances, update nodes and much more. 

## Application Overview
#### Backend solution
- Provide communication with zelcashd
- Proividing private API part, and public API part, ZelNode team API part (limited!)
- Listening and Handling frontend requests
- Requests signing and authenticity verifying
- Communication with other zelnodeds
- managing ZelNode applications - smart spawning, distributing workload, terminating depending of application subscription 
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

Mongodb and zelcashd has to be running

Production:

``` bash

sudo npm start

```

Development: Start both solutions with

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

Signed message requirement
- First 13 characters is timestamp
- The length of message must be at least 40 characters
- Message and corresponding signature must not be older than X seconds

### API CALLS

#### zelcashd calls
get /zelcash/help (Public)
returns help from zelcashd

get /zelcash/getinfo (Public)
returns getinfo from zelcashd

get /zelcash/getzelnodestatus (Public)
returns getzelnodestatus from zelcashd

get /zelcash/listzelnodes (Public)
returns listzelnodes from zelcashd

get /zelcash/listzelnodeconf (ZelNode Owner)
returns listzelnodeconf from zelcashd

#### zelid calls
get /zelid/loginphrase (Public)
returns a loginphrase - message that should be signed by zelid (or any bitcoin address). Message expires after 15 minutes. Only within these 15 minutes it is possible to log in with this message

post /zelid/verifylogin
post a stringified object of {
  message: loginPhrase,
  address: zelid/bitcoin address that signed this message,
  signature: signature of the message by that zelid
}
returns an object with status either error or success and data containing message explaining the outcome. Success means logged in. Error is error. Also return privilage status to api /user, admin, zelteam

websocket /ws/zelid/:loginphrase
It is possible to subscribe to listening to a response of logging with a certain loginphrase. Such response then contain loginPhrase, signature, address, message and privilage. This is useful for remote logging.

Protected API
- In order to access protected API, user has to be logged into the zelnode. Every request to protected API has to contain stringified zelidauth header of folowing object\
  {
    zelid: zelid/bitcoin address used for logging in,
    signature: signature of a loginPhrase message signed by this address. 
  }
  Note This loginPhrase must have been obtained by this zelnode and user (zelid) must be signed in to the zelnode with that loginPhrase

get /zelid/loggedusers (ZelNode Owner)
Returns an array of currently logged users into the zelnode
{ zelid: 1btc, loginPhrase: dddasd }

get /zelid/activeloginphrases (ZelNode Owner)
Return an array of currently active login phrases
  /* const activeLoginPhrases = [
     {
       loginPhrase: 1565356121335e9obp7h17bykbbvub0ts488wnnmd12fe1pq88mq0v,
       createdAt: 2019-08-09T13:08:41.335Z,
       expireAt: 2019-08-09T13:23:41.335Z
     }
  ] */

get /zelid/logoutallusers (ZelNode Owner)
Logs out all users

get /zelid/loggedsessions (User level)
Returns an array of currently logged users into the zelnode
{ zelid: 1btc, loginPhrase: dddasd }

get /zelid/logoutcurrentsession (User level)
Logs out current login session

post /zelid/logoutspecificsession (User level)
@param = loginPhrase ( signed message that is assigned to this specific session)
Returns status about logging out specific session

get /zelid/logoutallsessions (User level)
Logs out all login sessions - all devices (precisely all still valid logins)
