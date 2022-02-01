const inquirer = require('inquirer');
const fs = require('fs');

const path = './config/userconfig.js';

const goodchars = /^[1-9a-km-zA-HJ-NP-Z]+$/;
if (fs.existsSync(path)) {
  console.log('Configuration file found. You can change your configuration in ./config/userconfig.js');
  console.log('Starting Flux...');
  return;
}

const questions = [
  {
    type: 'input',
    name: 'ipaddr',
    message: 'What is your Flux IP address?',
  },
  {
    type: 'input',
    name: 'zelid',
    message: 'Flux uses ZelID system for authentication and verification purposes. What is your ZelID?',
  },
];

function showQuestions() {
  inquirer.prompt(questions).then((answers) => {
    console.log(`IP address: ${answers.ipaddr}`);
    console.log(`ZelID: ${answers.zelid}`);
    if (answers.ipaddr.length < 5 || (answers.ipaddr.indexOf('.') === -1 && answers.ipaddr.indexOf(':') === -1)) {
      console.log('IP address is NOT valid!');
      return showQuestions();
    }
    if (!goodchars.test(answers.zelid) || answers.zelid[0] !== '1' || answers.zelid.length > 34 || answers.zelid.length < 25) {
      console.log('ZelID is NOT valid!');
      return showQuestions();
    }

    if (answers.ipaddr.includes(':')) {
      if (!answers.ipaddr.includes('[')) {
        // eslint-disable-next-line no-param-reassign
        answers.ipaddr = `[${answers.ipaddr}`;
      }
      if (!answers.ipaddr.includes(']')) {
        // eslint-disable-next-line no-param-reassign
        answers.ipaddr = `${answers.ipaddr}]`;
      }
    }

    const dataToWrite = `module.exports = {
      initial: {
        ipaddress: '${answers.ipaddr}',
        zelid: '${answers.zelid}',
        testnet: false,
        apiport: 16127,
      }
    }`;

    const userconfig = fs.createWriteStream(path);

    userconfig.once('open', () => {
      userconfig.write(dataToWrite);
      userconfig.end();
    });
    console.log('Configuration successful. Values saved and they can be changed in ./config/userconfig.js');
    console.log('Starting Flux...');
    return 0;
  });
}
showQuestions();
