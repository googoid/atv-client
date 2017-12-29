const { AtvClient } = require('./lib/client');
const fs = require('fs');
let { log, randomString } = require('./lib/utils');
log = log.child({ app: 'example' });

let client;

AtvClient.find()
  .then(_client => client = _client)
  .then(() => {
    let credentials;

    try {
      credentials = require('./auth-token');
    }
    catch (e) {
      credentials = AtvClient.generateCredentials();
      fs.writeFileSync('./auth-token.js', 'module.exports = ' + JSON.stringify(credentials));
      log.info(credentials, 'Generated new credentials');
    }

    log.info(credentials, 'Using credentials to connect');

    return client.setCredentials(credentials.clientId, credentials.seed)
      .connect()
  })
  .then(() => {
    client.on('state', (state, oldState) => {
      console.log('state', state);
    });

    client.on('position', pos => {
      console.log('position', pos, 'seconds');
    });

    // client.play('http://data12-cdn.datalock.ru/fi2lm/053b096c10388c7357164adc532efffc/7f_Zapped.s02e01.HDTV720p.Rus.Eng.BaibaKo.tv.a1.23.10.17.mp4', 30);

    // setTimeout(() => {
    //   client.pause();
    // }, 10000);

    // setTimeout(() => {
    //   client.resume();
    // }, 20000);

    // setTimeout(() => {
    //   client.stop();
    // }, 30000);

    // setTimeout(() => {
    //   client.play('http://data12-cdn.datalock.ru/fi2lm/053b096c10388c7357164adc532efffc/7f_Zapped.s02e01.HDTV720p.Rus.Eng.BaibaKo.tv.a1.23.10.17.mp4', 10);
    // }, 40000);
  })
  .catch(err => log.error(err));
