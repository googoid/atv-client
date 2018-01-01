const net = require('net');
let { log } = require('./utils');
log = log.child({ component: 'request' });
const { EventEmitter } = require('events');
const util = require('util');
const uuid = require('uuid/v4');

function createConnection(host, port, name = 'socket') {
  let socket = net.createConnection(port, host);
  socket.__name = name;

  return socket;
}

function connect(host, port, name = 'socket') {
  return new Promise((resolve, reject) => {
    let socket = net.createConnection(port, host, err => {
      if (err) {
        return reject(err);
      }

      socket.__name = name;
      log.debug({ socket: socket.__name }, 'Connected to %s:%s', host, port);

      socket.once('error', err => {
        log.error(err, { socket: socket.__name });
      });

      // socket.once('end', () => {
      //   log.debug('Connection ended');
      // });

      // socket.once('close', () => {
      //   log.debug('Connection closed');
      // });

      socket.setKeepAlive(true);
      resolve(socket);
    });
  });
}

function compilePayload(init, headers)  {
  return [init].concat(Object.keys(headers).map(k => `${k}: ${headers[k]}`)).concat(['\r\n']).join('\r\n');
}

function requestSocket(socket, method, path, contentType, data) {
  return new Promise((resolve, reject) => {
    let init = `${method} ${path} HTTP/1.1`;
    let headers = {
      'User-Agent': 'AirPlay/320.20',
      // 'User-Agent': 'MediaControl/1.0',
      // 'User-Agent': 'iTunes/10.6 (Macintosh; Intel Mac OS X 10.7.3) AppleWebKit/535.18.5',
      'Connection': 'keep-alive'
    };

    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    headers['Content-Length'] = data ? data.length : 0;

    let payload = compilePayload(init, headers);

    if (data && contentType.indexOf('text') === 0 && data) {
      log.debug({ socket: socket.__name }, payload + data.toString('binary'));
    }
    else {
      log.debug({ socket: socket.__name }, payload);
    }

    socket.write(payload, 'utf8', !data ? resolve : undefined);

    if (data) {
      socket.write(data, resolve);
    }
  })
  .then(() => {
    return new Promise((resolve, reject) => {
      log.debug({ socket: socket.__name }, 'Finished writing request header and body');

      function onData(data) {
        log.debug({ socket: socket.__name }, data.toString());
        let resp = parseResponse(data.toString('binary'));

        log.debug({ socket: socket.__name }, 'Got response %d, content length: %d, real: %d', resp.status, parseInt(resp.headers['content-length']), resp.body.length);

        if (resp.status !== 200) {
          return reject({ socket: socket.__name }, 'Got error response: ' + resp.status);
        }

        return resolve(resp);
      }

      socket.once('data', onData);
    });
  });
}

function parseResponse(raw) {
  let headers = {};
  let status = '';
  let body = '';

  let lines = raw.split(/\r?\n/g);

  let headingEnd = lines.findIndex(line => {
    let statusLine = line.match(/HTTP\/1\.[0-1]\s([0-9]{3})/);

    if (statusLine) {
      status = parseInt(statusLine[1]);
    }
    else if (!line.length) {
      return true;
    }
    else {
      let semicolon = line.indexOf(':');
      headers[line.substr(0, semicolon).toLowerCase()] = line.substr(semicolon + 1).replace(/^\s*(.*)\s*/, '$1');
    }
  });

  body = new Buffer(lines.slice(headingEnd + 1).join('\n'), 'binary');

  return { status, headers, body };
}

function postDataSocket(socket, path, contentType, data) {
  return requestSocket(socket, 'POST', path, contentType, data);
}

function putDataSocket(socket, path, contentType, data) {
  return requestSocket(socket, 'PUT', path, contentType, data);
}

function getDataSocket(socket, path) {
  return requestSocket(socket, 'GET', path, null, null);
}

class ReverseConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;

    this.init();
  }

  init() {
    let payload = compilePayload('POST /reverse HTTP/1.1', {
      'Upgrade': 'PTTH/1.0',
      'Connection': 'Upgrade',
      'X-Apple-Purpose': 'event',
      'User-Agent': 'MediaControl/1.0',
      'X-Apple-Session-ID': uuid()
    });

    this.socket.write(payload, () => {
      this.socket.on('data', data => {
        log.info({ socket: this.socket.__name }, data.toString());

        let res = parseResponse(data.toString('binary'))

        if (res.status !== 101) {
          this.socket.write(compilePayload('HTTP/1.1 200 OK', { 'Content-Length': 0 }), () => {
            this.emit('response', res);
          });
        }
      });
    });
  }
}


module.exports = { connect, postDataSocket, putDataSocket, getDataSocket, ReverseConnection, createConnection };
