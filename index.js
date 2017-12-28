const mdns = require('mdns');
const browser = mdns.createBrowser(mdns.tcp('airplay'));
// const request = require('superagent');
const fs = require('fs');
const { log, randomString} = require('./utils');

const net = require('net');

const crypto = require('crypto');
const eddsa = require('ed25519');

const { promisify } = require('util');
const prompt = require('prompt');
const { connect, postDataSocket, getDataSocket, ReverseConnection } = require('./request');

const pairing = require('./pairing');
const verifying = require('./verifying');

const plist = require('simple-plist');

let authToken = null;
let seed = null;
let clientId = null;
let deviceId = null;
let ipAddress = null;
let port = null;

try {
  authToken = require('./auth-token');
}
catch (e) {
  authToken = newAuthToken();
  fs.writeFileSync('./auth-token.js', 'module.exports=' + JSON.stringify(authToken));
}

let authTokenSplit = authToken.split('@');
clientId = authTokenSplit[0];
seed = Buffer.from(authTokenSplit[1], 'hex')
let kp = eddsa.MakeKeypair(seed);
authKey = { privateKey: kp.privateKey.slice(0, 32), publicKey: kp.publicKey };

browser.on('serviceUp', function(service) {
  deviceId = service.txtRecord.deviceid;
  ipAddress = service.addresses.find(net.isIPv4);
  port = service.port;

  log.info('Discovered Apple TV at %s, MAC: %s', ipAddress, deviceId);

  authenticate();
  reverseConnection();
});
browser.start();

function reverseConnection() {
  let socket;

  return connect(ipAddress, port)
    .then(_socket => socket = _socket)
    .then(() => verifying.verify(socket, authKey))
    .then(() => {
      let conn = new ReverseConnection(socket);

      conn.on('response', res => {
        console.log(res);
      });

      conn.on('error', err => log.error(err));
    })
    .catch(err => {
      socket && socket.destroy();
      log.error(err);
    });
}

function authenticate() {
  let socket;

  // available: stopped, playing, paused

  return connect(ipAddress, port)
    .then(_socket => socket = _socket)
    .then(() => verifying.verify(socket, authKey))
    .then(() => log.info('Pairing verified'))
    .catch(() => {
      return startPairing(socket)
        .then(requestPINInput)
        .then(pin => pairing.pair(socket, clientId, pin))
        .then(res => log.info('Pairing successfully finished'));
    })
    .then(() => log.info('Ready for commands'))
    .then(() => postDataSocket(socket, '/play', 'application/x-apple-binary-plist', plist.bplistCreator({
        'Content-Location': '',
        'Start-Position': 0.5
      }), true))
    .then(() => {
      startPlaybackInfo(socket);
    })
    .catch(err => {
      socket && socket.destroy();
      log.error(err);
    });
}

let playbackState = 'stopped';

function startPlaybackInfo(socket) {
  getDataSocket(socket, '/playback-info')
    .then(res => {
      let state = plist.parse(res.body);

      if (JSON.stringify(state) === '{}') {
        // playback finished
        newState = 'stopped';
      }
      else {
        if (state.rate) {
          newState = 'playing';
        }
        else {
          newState = 'paused';
        }
      }
    })
    .catch(err => {
      log.error(err);
      newState = 'stopped';
    })
    .then(() => {
      if (playbackState !== newState) {
        log.info('Playback state changed from %s to %s', playbackState, newState);
        playbackState = newState;
      }

      if (newState !== 'stopped') {
        setTimeout(() => startPlaybackInfo(socket), 1000)
      }
    });
}

function startPairing(socket) {
  return postDataSocket(socket, '/pair-pin-start', null, null, true);
}

function newAuthToken() {
  let clientId = randomString(16);

  let seed = crypto.randomBytes(32);

  return clientId + '@' + seed.toString('hex');
}

function requestPINInput() {
  return (promisify(prompt.get))('pin')
    .then(data => data.pin);
}
