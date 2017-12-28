const { postDataSocket } = require('./request');
const crypto = require('crypto');
const plist = require('simple-plist');
const srp = require('fast-srp-hap');

function doPairSetupPin1(socket, clientId) {
  let list = {
    method: 'pin',
    user: clientId
  };

  return postDataSocket(socket, '/pair-setup-pin', 'application/x-apple-binary-plist', plist.bplistCreator(list), true)
    .then(res => plist.parse(res.body));
}

function doPairSetupPin2(socket, A, M1) {
  let list = {
    pk: A,
    proof: M1
  };

  return postDataSocket(socket, '/pair-setup-pin', 'application/x-apple-binary-plist', plist.bplistCreator(list), true)
    .then(res => plist.parse(res.body));
}

function doPairSetupPin3(socket, K) {
  let aesKey = crypto.createHash('sha512').update('Pair-Setup-AES-Key').update(K).digest().slice(0, 16);
  let aesIV = crypto.createHash('sha512').update('Pair-Setup-AES-IV').update(K).digest().slice(0, 16);
  aesIV[15]++;

  let cipher = crypto.createCipheriv('aes-128-gcm', aesKey, aesIV);
  let epk = cipher.update(authKey.publicKey);
  cipher.final();
  let authTag = cipher.getAuthTag();

  let list = { epk, authTag };

  return postDataSocket(socket, '/pair-setup-pin', 'application/x-apple-binary-plist', plist.bplistCreator(list), true)
    .then(res => plist.parse(res.body));
}

function pair(socket, clientId, pin) {
  return doPairSetupPin1(socket, clientId)
    .then(res => {
      let params = srp.params[2048];
      params.hash = 'sha1';

      let client = new srp.Client(params,
        res.salt,
        Buffer.from(clientId, 'utf8'),
        Buffer.from(pin, 'utf8'),
        authKey.privateKey);
      client.setB(res.pk);

      return doPairSetupPin2(socket, client.computeA(), client.computeM1())
        .then(() => doPairSetupPin3(socket, client.computeK()));
    });
}

module.exports = { pair };
