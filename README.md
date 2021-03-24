# Flux - Node Daemon

![Flux.png](ZelFront/src/assets/img/flux_banner.png)

[![DeepScan grade](https://deepscan.io/api/teams/6436/projects/8442/branches/100920/badge/grade.svg)](https://deepscan.io/dashboard#view=project&tid=6436&pid=8442&bid=100920)
[![CodeFactor](https://www.codefactor.io/repository/github/zelcash/zelflux/badge)](https://www.codefactor.io/repository/github/zelcash/zelflux)[![Language grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/zelcash/zelflux.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/zelcash/zelflux/context:javascript)

Flux is available on domains, load balancing the entire Flux network. You can
access both UI and API on following main domain

[Flux](https://home.runonflux.io)

[API](https://api.runonflux.io)

## API Documentation

[API documentation](https://zelcash.github.io/zelfluxdocs/)

## The gateway to the Flux Network

Flux is the frontend UI to the entire Flux Network, it enables Flux operators to
manage their Flux Node easily via a simple web interface. Flux enables an
operator to perform all tasks such as updating and maintenance from a simple web
interface, instead of having to remotely login to their Flux to manage it.

Flux Requires a reasonably new version of Node.js (npm), MongoDB and Docker. It
is a MongoDB, Express.js, Vue.js, Node.js (MEVN) application

This application communicates locally with the Flux Daemon (zelcashd), Benchmark
Daemon (zelbenchd) and other Flux instances.

## Application Overview

### Backend Solution - Flux

- Provide communication with daemon, benchmark
- Providing private API, and public API, Flux team API (limited!)
- Listen and handle frontend requests
- Requests signing and authenticity verifying
- Handle communication with other Fluxes
- Manage Flux applications - smart spawning, distributing workload, termination
  depending of application subscription.
- Provide Explorer solution
- and more!

### Frontend Solution - Home

- Display Flux status information
- Display Flux Network information
- Display Flux network information
- Display Specific application information
- Provide API access
- Login into private API part (frontend part)
- Login into Flux team API part (frontend part)
- Private: Management of Flux
- Private: Management of Flux Damone and Benchmark
- Private: Update, status information
- and more!

This application is open source and distributed under the GNU AGPLv3 licence

## Start Flux

Flux needs Daemon to be running, to setup Daemon follow
[these instructions.](https://github.com/zelcash/ZelNodeInstallv3)

build-essential is a recommended dependency

```bash

sudo apt-get build-essential
```

Setup Mongodb on Ubuntu 16.04 (LTS):

```bash
wget -qO - https://www.mongodb.org/static/pgp/server-4.2.asc | sudo apt-key add -

echo "deb [ arch=amd64 ] https://repo.mongodb.org/apt/ubuntu xenial/mongodb-org/4.2 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-4.2.list

sudo apt-get update

sudo apt-get install -y mongodb-org

sudo service mongod start
```

Setup Mongodb on Ubuntu 18.04 (LTS):

```bash
wget -qO - https://www.mongodb.org/static/pgp/server-4.2.asc | sudo apt-key add -

echo "deb [ arch=amd64 ] https://repo.mongodb.org/apt/ubuntu bionic/mongodb-org/4.2 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-4.2.list

sudo apt-get update

sudo apt-get install -y mongodb-org

sudo service mongod start
```

Setup Mongodb on Red Hat or CentOS:

```bash
sudo yum install nano

sudo nano /etc/yum.repos.d/mongodb-org-4.2.repo

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
sudo systemctl enable mongod.service

# Start Mongodb on startup for CentOS 5/6
sudo chkconfig mongod on

# Start Mongodb on CentOS 7
sudo systemctl start mongod.service

# Start Mongodb on CentOS 5/6
sudo service mongod start
```

Install Node Version Manager (NVM) and NodeJS 12 on Ubuntu 16.04/18.04:

```bash
sudo apt-get install curl

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.35.0/install.sh | bash

source ~/.profile

nvm install 12

nvm use 12
```

Install Node Version Manager (NVM) and NodeJS 12 on Redhat/CentOS:

```bash
sudo yum install curl

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.35.0/install.sh | bash

source ~/.bashrc

nvm install 12

nvm use 12
```

Install Docker using snap

```bash
snap install docker
```

Clone Flux repo (Ubuntu):

```bash
sudo apt-get install git

git clone https://github.com/zelcash/Flux
```

Clone Flux repo (Redhat/CentOS):

```bash
sudo yum install git

git clone https://github.com/zelcash/Flux
```

Allow Inbound Connections on UFW firewall (ONLY if ufw enabled):

```bash
sudo ufw allow 16126/tcp
sudo ufw allow 16127/tcp
```

Install Flux dependancies (Ubuntu/CentOS/Redhat):

```bash
cd Flux

npm install
```

To run this as Production:

```bash
npm start
```

To run this as Development: Start both solutions with

```bash
npm run fluxdev
npm run homedev
```

THE SETUP ENDS HERE... The following information below provided for brief usage
guidelines and/or examples only.

## Flux Home Information

> Frontend interface to interact with the Zel network Uses port 16126

## Build Setup

```bash
# serve with hot reload at localhost:16126
npm run homedev

# build for production with minification
npm run homebuild

# build for production and view the bundle analyzer report
npm run homebuild --report
```

## Flux Information

> Backend interface to interact with the Flux Network Uses port 16127

## Continued Build Setup

```bash
# serve with hot reload at localhost:16126
npm run fluxdev
```

Made with ❤️ by the Flux Team
