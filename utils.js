const bunyan = require('bunyan');
const log = bunyan.createLogger({ name: 'AppleTV' });

function randomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min; //The maximum is exclusive and the minimum is inclusive
}

function randomString(length) {
  let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let res = '';

  for (let i = 0; i < length; i++) {
    res += chars[randomInt(0, chars.length)];
  }

  return res;
}



module.exports = { log, randomInt, randomString };
