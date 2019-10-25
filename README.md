# ZelFlux - ZelNode Daemon

![ZelNode.gif](ZelFront/src/assets/img/zelnode.gif)

## The gateway to the Zel Network

ZelFlux is the frontend UI to the entire Zel Network, it enables ZelNode operators to manage their ZelNode easily via a simple web interface. ZelFlux enables a ZelNode operator to perform all tasks such as updating and maintenance from a simple web interface, instead of having to remotely login to their ZelNode to manage it.

ZelFlux Requires a reasonably new version of Node.js (npm) and MongoDB. It is a MongoDB, Express.js, Vue.js, Node.js (MEVN) application

This application communicates locally with the ZelCash Daemon (zelcashd), ZelBench Daemon (benchmarkd) and with other ZelNode Daemons (zelflux).

## Application Overview

### Backend Solution - zelback

-   Provide communication with zelcashd
-   Providing private API, and public API, ZelNode team API (limited!)
-   Listen and handel frontend requests
-   Requests signing and authenticity verifying
-   Handel communication with other zelnode daemons (zelflux solution)
-   Manage ZelNode applications - smart spawning, distributing workload, termination depending of application subscription.
-   and more!

### Frontend Solution - zelfront

-   Display ZelNode status information
-   Display Zel Network information
-   Display ZelCash status information
-   Display ZelCash network information
-   Display Specific application information
-   Provide API access
-   Login into private API part (frontend part)
-   Login into ZelNode team API part (frontend part)
-   Private: Management of ZelNode
-   Private: Management of ZelCash
-   Private: Update, status information
-   and more!

This application is open source and distributed under the GNU AGPLv3 licence

## Start ZelFlux

ZelFlux needs Zelcashd to be ruuning, to setup Zelcashd follow [these instructions.](https://github.com/zelcash/ZelNodeInstallv3)

Setup Mongodb on Ubuntu 16.04 (LTS):

```bash
echo "deb [ arch=amd64 ] https://repo.mongodb.org/apt/ubuntu xenial/mongodb-org/4.2 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-4.2.list

sudo apt-get update

sudo apt-get install -y mongodb-org

sudo service mongod start
```

Setup Mongodb on Ubuntu 18.04 (LTS):

```bash
echo "deb [ arch=amd64 ] https://repo.mongodb.org/apt/ubuntu bionic/mongodb-org/4.2 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-4.2.list

sudo apt-get update

sudo apt-get install -y mongodb-org

sudo service mongod start
```

Setup Mongodb on Red Hat or CentOS:

```bash
yum install nano

nano /etc/yum.repos.d/mongodb-org-4.2.repo

# Paste below into the mongodb-org-4.2.repo file

[mongodb-org-4.2]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/$releasever/mongodb-org/4.2/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://www.mongodb.org/static/pgp/server-4.2.asc

# exit nano

sudo yum install -y mongodb-org

# Start Mongodb on startup for CentOS 7
systemctl enable mongod.service

# Start Mongodb on startup for CentOS 5/6
chkconfig mongod on

# Start Mongodb on CentOS 7
systemctl start mongod.service

# Start Mongodb on CentOS 5/6
service mongod start
```

Install Node Version Manager (NVM) and NodeJS 11 on Ubuntu 16.04/18.04:

```bash
apt-get install curl

curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.34.0/install.sh | bash

bash install_nvm.sh

source ~/.profile

nvm install 11

nvm use 11
```

Install Node Version Manager (NVM) and NodeJS 11 on Redhat/CentOS:

```bash
yum install curl

curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.34.0/install.sh | bash

source ~/.bashrc

nvm install 11

nvm use 11
```

Clone ZelFlux repo (Ubuntu):

```bash
apt-get install git

git clone https://github.com/zelcash/zelflux
```

Clone ZelFlux repo (Redhat/CentOS):

```bash
yum install git

git clone https://github.com/zelcash/zelflux
```

Install ZelFlux dependancies (Ubuntu/CentOS/Redhat):

```bash
cd zelflux

npm install
```

Production:

```bash
sudo npm start
```

Development: Start both solutions with

```bash
npm run zelbackdev
npm run zelfrontdev
```

## ZelFront Information

> Frontend interface to interact with the Zel network

## Build Setup

```bash
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

## ZelBack Information

> Backend interface to interact with the Zel Network
> Default port is 16126
> Communication port with other zelnodes is 16127

## Continued Build Setup

```bash
# serve with hot reload at localhost:16126
npm run zelbackdev
```

Signed message requirement

-   First 13 characters is timestamp
-   The length of message must be at least 40 characters
-   Message and corresponding signature must not be older than X seconds

### API Calls

#### - zelcashd Calls

```bash
# return help from zelcashd
get /zelcash/help # (Public)
```

```bash
# return reinfo from zelcashd
get /zelcash/getinfo # (Public)
```

```bash
# return getzelnodestatus from zelcashd
get /zelcash/getzelnodestatus # (Public)
```

```bash
# return listzelnodes from zelcashd
get /zelcash/listzelnodes #(Public)
```

```bash
# return list zelnodeconf from zelcashd
get /zelcash/listzelnodeconf #(ZelNode Owner)
```

#### - zelid Calls

```bash
# return a loginphrase - message that should be signed by zelid (or any bitcoin address). Message expires after 15 minutes. Only within these 15 minutes it is possible to log in with this message
get /zelid/loginphrase # (Public)
```

```bash
# Return an object with a status of either error or success and the data containing message explaining the outcome. Success means logged in. Error means, well, error. It also returns the privilege status to the api according to the user, admin, zelteam.

post /zelid/verifylogin # (Public)

# // this posts a stringified object of {
#  message: loginPhrase,
#  address: zelid/bitcoin address that signed this message,
#  signature: signature of the message by that zelid
# }
```

```bash
# Subscribe to listen for notification response of user logins with a certain loginphrase. Such response contains loginPhrase, signature, address, message and privilege. This is useful for remote logging.
websocket /ws/zelid/:loginphrase # (Public)
```

#### Protected API

-   In order to access protectred API, user has to be logged into their ZelNode. Every request to the protected API has to contain stringified zelidauth header of following object

```html
 {
  zelid: zelid/bitcoin address used for logging in,
 signature: signature of a loginPhrase message signed by ths address.
  }

 // Note this loginPhrase must have been obtained by this ZelNode and user (zelid) must be signed in to the ZelNode with the loginPhrase
```

```bash
# Return an array of users currently logged into the ZelNode
get /zelid/loggeduser # (ZelNode Owner)

# Example response
# { zelid: 1btc, loginPhrase: dddasd}
```

```bash
#Return an array of currently active login phrases
get /zelid/activeloginphrases # (ZelNode Owner)

# Example response
#  /* const activeLoginPhrases = [
#     {
#       loginPhrase: 1565356121335e9obp7h17bykbbvub0ts488wnnmd12fe1pq88mq0v,
#       createdAt: 2019-08-09T13:08:41.335Z,
#       expireAt: 2019-08-09T13:23:41.335Z
#     }
#  ] */
```

```bash
# Log out all users
get /zelid/logoutallusers # (ZelNode Owner)
```

```bash
# Return an array of currently logged users into the ZelNode
get /zelid/loggedsessions # (User level)
```

```bash
#Log out current login session
get /zelid/logoutcurrentsession # (User level)
```

```bash
#Return status about logging out specific sessions
post /zelid/logoutspecificsession # (User level)
# @param = loginPhrase # ( signed message that is assigned to this specific session)
```

```bash
#Log out all login sessions - all devices (precisely all still valid logins)
get /zelid/logoutallsessions # (User level)
```

Made with ❤️ by the Zel Team
