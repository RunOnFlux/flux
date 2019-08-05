const inquirer = require('inquirer')
const fs = require('fs')
const path = './config/userconfig.js'

const goodchars = /^[1-9a-km-zA-HJ-NP-Z]+$/
const alfasymbols = /(.*[a-zA-Z]){1}/i
if (fs.existsSync(path)) {
  process.exit()
}

const questions = [
  {
    type: 'input',
    name: 'ipaddr',
    message: "What's your IP address?"
  },
  {
    type: 'input',
    name: 'zelid',
    message: "What's your Zel ID?"
  }
]

function showQuestions() {
  inquirer.prompt(questions).then(answers => {
    console.log(`IP address: ${answers['ipaddr']}`)
    console.log(`zel ID: ${answers['zelid']}`)
    if (answers['ipaddr'].length < 5 || alfasymbols.test(answers['ipaddr']) || (answers['ipaddr'].indexOf('.') === -1 && answers['ipaddr'].indexOf(':') === -1)) {
      console.log('IP address is NOT valid!')
      return showQuestions()
    }
    if (!goodchars.test(answers['zelid']) || answers['zelid'][0] !== '1' || answers['zelid'].length > 34 || answers['zelid'].length < 25) {
      console.log('zelID is NOT valid!')
      return showQuestions()
    }
    console.log('Configuration successful. Values can be chaned in config/userconfig.js')
    // todo save to device path
    const dataToWrite = `module.exports = {
      initial: {
        ipaddress: ${answers['ipaddr']},
        zelid: ${answers['zelid']}
      }
    }`

    const userconfig = fs.createWriteStream(path)

    userconfig.once('open', () => {
      userconfig.write(JSON.stringify(dataToWrite))
      userconfig.end()
    })
    process.exit()
  })
}
showQuestions()
