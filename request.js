const net = require('net');
const { log } = require('./utils');
const { EventEmitter } = require('events');
const util = require('util');
const uuid = require('uuid/v4');

function connect(host, port) {
  return new Promise((resolve, reject) => {
    let socket = net.createConnection(port, host, err => {
      if (err) {
        return reject(err);
      }

      log.debug('Connected to %s:%s', host, port);

      socket.once('error', err => {
        log.error(err);
      });

      socket.once('end', () => {
        log.debug('Connection ended');
      });

      socket.once('close', () => {
        log.debug('Connection closed');
      });

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
      log.debug(payload + data.toString('binary'));
    }
    else {
      log.debug(payload);
    }

    socket.write(payload, 'utf8', !data ? resolve : undefined);

    if (data) {
      socket.write(data, resolve);
    }
  })
  .then(() => {
    return new Promise((resolve, reject) => {
      log.debug('Finished writing request header and body');

      function onData(data) {
        let resp = parseResponse(data.toString('binary'));

        log.debug('Got response %d, content length: %d, real: %d', resp.status, parseInt(resp.headers['content-length']), resp.body.length);

        if (resp.status !== 200) {
          return reject('Got error response: ' + resp.status);
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

function getDataSocket(socket, path) {
  return requestSocket(socket, 'GET', path, null, null);
}

function ReverseConnection(socket) {
  let payload = compilePayload('POST /reverse HTTP/1.1', {
    'Upgrade': 'PTTH/1.0',
    'Connection': 'Upgrade',
    'X-Apple-Purpose': 'event',
    'User-Agent': 'MediaControl/1.0',
    'X-Apple-Session-ID': uuid()
  });

  socket.write(payload, () => {
    socket.on('data', data => {
      let res = parseResponse(data.toString('binary'))

      if (res.status !== 101) {
        socket.write(compilePayload('HTTP/1.1 200 OK', { 'Content-Length': 0 }), () => {
          this.emit('response', res);
        });
      }
    });
  });
}

util.inherits(ReverseConnection, EventEmitter);

module.exports = { connect, postDataSocket, getDataSocket, ReverseConnection };
