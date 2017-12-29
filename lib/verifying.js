const crypto = require('crypto');
const curve = require('curve25519-n2');
const eddsa = require('ed25519');
const { log } = require('./utils');
const { postDataSocket  } = require('./request');
const fs = require('fs');

class Verifier {
  constructor(socket, auth) {
    this.socket = socket;
    this.auth = auth;
  }

  verify1() {
    this.verifyPrivate = curve.makeSecretKey(Buffer.from(this.auth.privateKey));
    this.verifyPublic = curve.derivePublicKey(this.verifyPrivate);

    let data = Buffer.concat([Buffer.from([1, 0, 0, 0]), this.verifyPublic, this.auth.publicKey]);
    fs.writeFileSync('test.data', data);

    return postDataSocket(this.socket, '/pair-verify', 'application/octet-stream', data, true)
      .then(res => ({ pk: res.body.slice(0, 32), tail: res.body.slice(32) }));
  }

  verify2(atvPublicSecret, tail) {
    let shared = curve.deriveSharedSecret(this.verifyPrivate, atvPublicSecret);

    let aesKey = crypto.createHash('sha512').update('Pair-Verify-AES-Key').update(shared).digest().slice(0, 16);
    let aesIV = crypto.createHash('sha512').update('Pair-Verify-AES-IV').update(shared).digest().slice(0, 16);

    let key = eddsa.MakeKeypair(this.auth.privateKey);
    let signed = eddsa.Sign(Buffer.concat([this.verifyPublic, atvPublicSecret]), key);
    let cipher = crypto.createCipheriv('aes-128-ctr', aesKey, aesIV);
    cipher.update(tail);
    let signature = cipher.update(signed);
    cipher.final();

    let data = Buffer.concat([Buffer.from([0, 0, 0, 0]), signature]);

    return postDataSocket(this.socket, '/pair-verify', 'application/octet-stream', data, true);
  }

  verify() {
    return this.verify1()
      .then(res => this.verify2(res.pk, res.tail));
  }
}

function verify(socket, auth) {
  const verifier = new Verifier(socket, auth);
  return verifier.verify();
}

module.exports = { verify };
