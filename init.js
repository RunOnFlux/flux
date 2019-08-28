const inquirer = require('inquirer');
const fs = require('fs');

const path = './config/userconfig.js';

const goodchars = /^[1-9a-km-zA-HJ-NP-Z]+$/;
const alfasymbols = /(.*[a-zA-Z]){1}/i;
if (fs.existsSync(path)) {
  console.log('Configuration file found. You can change your configuration in ./config/userconfig.js');
  console.log('Starting Flux...');
  return;
}

const questions = [
  {
    type: 'input',
    name: 'ipaddr',
    message: 'What is your ZelNode IP address?',
  },
  {
    type: 'input',
    name: 'zelid',
    message: 'What is your Zel ID?',
  },
];

function showQuestions() {
  inquirer.prompt(questions).then((answers) => {
    console.log(`IP address: ${answers.ipaddr}`);
    console.log(`zel ID: ${answers.zelid}`);
    if (answers.ipaddr.length < 5 || alfasymbols.test(answers.ipaddr) || (answers.ipaddr.indexOf('.') === -1 && answers.ipaddr.indexOf(':') === -1)) {
      console.log('IP address is NOT valid!');
      return showQuestions();
    }
    if (!goodchars.test(answers.zelid) || answers.zelid[0] !== '1' || answers.zelid.length > 34 || answers.zelid.length < 25) {
      console.log('zelID is NOT valid!');
      return showQuestions();
    }

    const dataToWrite = `module.exports = {
      initial: {
        ipaddress: '${answers.ipaddr}',
        zelid: '${answers.zelid}'
      }
    }`;

    const userconfig = fs.createWriteStream(path);

    userconfig.once('open', () => {
      userconfig.write(dataToWrite);
      userconfig.end();
    });
    console.log('Configuration successful. Values saved and can be changed in ./config/userconfig.js');
    console.log('Starting Flux...');
    return 0;
  });
}
showQuestions();
