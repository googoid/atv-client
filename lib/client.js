const { isIPv4 } = require('net');
const mdns = require('mdns');
const eddsa = require('ed25519');
const crypto = require('crypto');
const { EventEmitter } = require('events');
let { log, randomString } = require('./utils');
log = log.child({ component: 'AtvClient' });
const { connect, postDataSocket, getDataSocket, ReverseConnection } = require('./request');
const { pair, startPairing } = require('./pairing');
const { verify } = require('./verifying');
const prompt = require('prompt');
const plist = require('simple-plist');

class AtvClient extends EventEmitter {
  constructor(deviceId, host, port) {
    super();

    this.deviceId = deviceId;
    this.host = host;
    this.port = port;
  }

  static find(timeout = 5) {
    return new Promise((resolve, reject) => {
      let tmid;
      let browser = mdns.createBrowser(mdns.tcp('airplay'), {
        resolverSequence: [
          mdns.rst.DNSServiceResolve(),
          'DNSServiceGetAddrInfo' in mdns.dns_sd ? mdns.rst.DNSServiceGetAddrInfo() : mdns.rst.getaddrinfo({ families: [4] }), // ipv6 makes problems for rasperry pi
          mdns.rst.makeAddressesUnique()
        ]
      });

      browser.on('serviceUp', function(service) {
        let deviceId = service.txtRecord.deviceid;
        let ipAddress = service.addresses.find(isIPv4);
        let port = service.port;

        if (!deviceId || !ipAddress || !port) {
          return;
        }

        log.info('Discovered Apple TV at %s, MAC: %s', ipAddress, deviceId);
        clearTimeout(tmid);
        browser.stop();
        resolve(new AtvClient(deviceId, ipAddress, port));

        // authenticate();
        // reverseConnection();
      });

      tmid = setTimeout(() => {
        browser.stop();
        reject(new Error('Timeout'));
      }, timeout * 1000);

      browser.start();
    });
  }

  setCredentials(clientId, seed) {
    this.clientId = clientId;
    this.seed = Buffer.from(seed, 'hex')
    let kp = eddsa.MakeKeypair(this.seed);
    this.authKey = { privateKey: kp.privateKey.slice(0, 32), publicKey: kp.publicKey };

    return this;
  }

  static generateCredentials() {
    let clientId = randomString(16);
    let seed = crypto.randomBytes(32);

    return { clientId, seed: seed.toString('hex') };
  }

  _authenticate(socket) {
    return verify(socket, this.authKey)
      .catch(() => {
        return startPairing(socket)
          .then(AtvClient.pinPrompt)
          .then(pin => pair(socket, this.clientId, pin))
          .then(res => log.info('Pairing successful'));
      });
  }

  connect() {
    return connect(this.host, this.port)
      .then(socket => this.socket = socket)
      .then(() => this._authenticate(this.socket))
      .then(() => connect(this.host, this.port))
      .then(socket => this.infoSocket = socket)
      .then(() => this._authenticate(this.infoSocket))
      .then(() => this._startReporting())
      .then(() => this);
  }

  disconnect() {
    this.socket.destroy();
    this.infoSocket.destroy();
    return Promise.resolve(this);
  }

  _startReporting() {
    this.getState()
      .then(state => {
        this.state = state.state;
        this.position = state.position;
        this.duration = state.duration;
      })
      .then(() => {
        this._reportingTmid = setTimeout(() => this._startReporting(), 1000);
      });
  }

  _stopReporting() {
    clearTimeout(this._reportingTmid);
    delete this._reportingTmid;
  }

  getState() {
    return getDataSocket(this.infoSocket, '/playback-info')
      .then(res => {
        let state = plist.parse(res.body);
        let newState;

        if (JSON.stringify(state) === '{}') {
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

        return { state: newState, position: parseInt(state.position || 0), duration: parseInt(state.duration || 0) };
      })
      .catch(err => {
        return { state: 'stopped', position: 0, duration: 0 };
      });
  }

  get state() {
    return this._state;
  }

  set state(value) {
    if (this._state !== value) {
      this.emit('state', value, this._state);

      if (value === 'playing' && this._offsetOnce) {
        this.seek(this._offsetOnce).then(console.log).catch(console.log);
        delete this._offsetOnce;
      }
    }

    this._state = value;
  }

  get position() {
    return this._position;
  }

  set position(value) {
    if (this._position !== value) {
      this.emit('position', value, this._position);
    }

    this._position = value;
  }

  get duration() {
    return this._duration;
  }

  set duration(value) {
    this._duration = value;
  }

  play(url, offset) {
    this._offsetOnce = offset;

    return postDataSocket(this.socket, '/play', 'application/x-apple-binary-plist', plist.bplistCreator({
        'Content-Location': url,
        'Start-Position': 0
      }))
      .then(() => this.state = 'stopped')
      .then(() => this);
  }

  seek(position) {
    return postDataSocket(this.socket, '/scrub?position=' + position, null, null)
      .then();
  }

  pause() {
    return postDataSocket(this.socket, '/rate?value=0', null, null)
      .then();
  }

  resume() {
    return postDataSocket(this.socket, '/rate?value=1', null, null)
      .then();
  }

  stop() {
    return postDataSocket(this.socket, '/stop', null, null)
      .then();
  }

  static pinPrompt() {
    return (promisify(prompt.get))('pin')
      .then(data => data.pin);
  }
}

module.exports = { AtvClient };
