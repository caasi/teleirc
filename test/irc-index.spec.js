'use strict';

var assert = require('assert');
var net = require('net');

require('./helpers/sandbox');

var config = require('../src/config');
var ircInit = require('../src/irc/index');

// A minimal IRC server on 127.0.0.1: it registers the client, confirms the
// JOIN, and then sends the lines that the test gives.
function fakeIrcServer(linesAfterJoin, done) {
    var sockets = [];
    var server = net.createServer(function(socket) {
        sockets.push(socket);
        var buffer = '';
        var send = function(line) {
            socket.write(line + '\r\n');
        };
        socket.on('data', function(data) {
            buffer += data;
            var lines = buffer.split('\n');
            buffer = lines.pop();
            lines.forEach(function(line) {
                line = line.replace(/\r$/, '');
                var command = line.split(' ')[0];
                // Answer only CAP LS. irc-framework answers each LS with
                // CAP END, so an answer to CAP END starts a loop.
                if (command === 'CAP' && line.split(' ')[1] === 'LS') {
                    send(':srv CAP * LS :');
                } else if (command === 'USER') {
                    send(':srv 001 bot :Welcome');
                    send(':srv 376 bot :End of MOTD');
                } else if (command === 'JOIN') {
                    send(':bot!b@h JOIN ' + line.split(' ')[1]);
                    linesAfterJoin.forEach(send);
                }
            });
        });
    });
    server.listen(0, '127.0.0.1', function() {
        done(server.address().port);
    });
    server.stop = function() {
        sockets.forEach(function(socket) {
            socket.destroy();
        });
        server.close();
    };
    return server;
}

// Points the bridge at the fake server, starts it, and calls onMessage for
// each message that it relays.
function startBridge(linesAfterJoin, onMessage) {
    return fakeIrcServer(linesAfterJoin, function(port) {
        config.ircServer = '127.0.0.1';
        config.ircOptions.port = port;
        config.ircNick = 'bot';
        config.ircPerformCmds = [];
        config.channels = [{ircChan: '#chan', tgGroup: 'TestGroup'}];
        ircInit(onMessage);
    });
}

describe('irc/index', function() {
    var server;
    var saved;

    // src/config exports one shared object. Give it back to later specs as
    // it was.
    before(function() {
        saved = {
            ircServer: config.ircServer,
            port: config.ircOptions.port,
            ircNick: config.ircNick,
            ircPerformCmds: config.ircPerformCmds,
            channels: config.channels
        };
    });

    after(function() {
        config.ircServer = saved.ircServer;
        config.ircOptions.port = saved.port;
        config.ircNick = saved.ircNick;
        config.ircPerformCmds = saved.ircPerformCmds;
        config.channels = saved.channels;
    });

    afterEach(function() {
        if (server) {
            server.stop();
        }
    });

    it('relays a channel NOTICE with its reply id (issue #11)', function(done) {
        server = startBridge([':erin!e@h NOTICE #chan :a notice $1a2b'], function(message) {
            assert.strictEqual(message.protocol, 'irc');
            assert.strictEqual(message.user, 'erin');
            assert.strictEqual(message.text, 'a notice $1a2b');
            assert.strictEqual(message.replyTo, '1a2b');
            done();
        });
    });
});
