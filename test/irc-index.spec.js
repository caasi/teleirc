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
                server.received.push(line);
                var command = line.split(' ')[0];
                // Answer only CAP LS. irc-framework answers each LS with
                // CAP END, so an answer to CAP END starts a loop.
                if (command === 'CAP' && line.split(' ')[1] === 'LS') {
                    send(':srv CAP * LS :');
                } else if (command === 'USER') {
                    send(':srv 001 ' + (server.welcomeNick || 'bot') + ' :Welcome');
                    send(':srv 376 bot :End of MOTD');
                } else if (command === 'PRIVMSG' && server.onPrivmsg) {
                    server.onPrivmsg(line);
                } else if (command === 'JOIN') {
                    send(':bot!b@h JOIN ' + line.split(' ')[1]);
                    linesAfterJoin.forEach(send);
                }
            });
        });
    });
    server.received = [];
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
    var server = fakeIrcServer(linesAfterJoin, function(port) {
        config.ircServer = '127.0.0.1';
        config.ircOptions.port = port;
        config.ircNick = 'bot';
        config.ircPerformCmds = [];
        config.channels = [{ircChan: '#chan', tgGroup: 'TestGroup'}];
        server.irc = ircInit(onMessage);
    });
    return server;
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
            channels: config.channels,
            relayIRCEvents: config.relayIRCEvents,
            parseMode: config.parseMode,
            emNick: config.emNick,
            floodProtectionDelay: config.ircOptions.floodProtectionDelay
        };
        config.ircOptions.floodProtectionDelay = 50;
    });

    after(function() {
        config.ircServer = saved.ircServer;
        config.ircOptions.port = saved.port;
        config.ircNick = saved.ircNick;
        config.ircPerformCmds = saved.ircPerformCmds;
        config.channels = saved.channels;
        config.ircOptions.floodProtectionDelay = saved.floodProtectionDelay;
    });

    afterEach(function() {
        config.relayIRCEvents = saved.relayIRCEvents;
        config.parseMode = saved.parseMode;
        config.emNick = saved.emNick;
        if (server) {
            server.stop();
        }
    });

    it('sets bot mode +B before it joins a channel', function(done) {
        // Libera.Chat does not let a client change bot mode while it is in a
        // channel, so the MODE must reach the server before the first JOIN.
        server = startBridge([':erin!e@h NOTICE #chan :ready'], function() {
            var commands = server.received.filter(function(line) {
                return /^(MODE|JOIN) /.test(line);
            });
            assert.deepStrictEqual(commands, ['MODE bot +B', 'JOIN #chan']);
            done();
        });
    });

    it('sets bot mode on the nick that the server gives in 001', function(done) {
        // A server can register the client with a nick other than the one it
        // asked for, for example a nick cut to NICKLEN.
        server = startBridge([':erin!e@h NOTICE #chan :ready'], function() {
            var modes = server.received.filter(function(line) {
                return /^MODE /.test(line);
            });
            assert.deepStrictEqual(modes, ['MODE bot_ +B']);
            done();
        });
        server.welcomeNick = 'bot_';
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

    it('ignores an action to a target that is not a bridged channel', function(done) {
        // A private "/me" to the bot. The channel NOTICE after it shows that
        // the bridge is still up and that it did not relay the action.
        server = startBridge([
            ':erin!e@h PRIVMSG bot :\x01ACTION waves\x01',
            ':erin!e@h NOTICE #chan :still here'
        ], function(message) {
            assert.strictEqual(message.text, 'still here');
            done();
        });
    });

    it('relays an action as plain text, also in html mode (#9)', function(done) {
        // tg/index.js adds the markup and the escape for Telegram.
        config.parseMode = 'html';
        config.emNick = true;
        server = startBridge([':erin!e@h PRIVMSG #chan :\x01ACTION a < b & c\x01'],
            function(message) {
                assert.strictEqual(message.type, 'action');
                assert.strictEqual(message.original.user, 'erin');
                assert.strictEqual(message.text, 'a < b & c');
                done();
            });
    });

    it('ignores join, part, kick and WHO for an unbridged channel (#12)', function(done) {
        config.relayIRCEvents = ['notice', 'join', 'part', 'kick'];
        server = startBridge([
            ':erin!e@h JOIN #other',
            ':erin!e@h PART #other',
            ':op!o@h KICK #other someone :bye',
            ':srv 315 bot #other :End of WHO list',
            ':erin!e@h NOTICE #chan :still here'
        ], function(message) {
            // The JOIN of the bot to #chan is relayed too, so check the
            // fault itself: a relayed message with no channel.
            assert.ok(message.channel, 'no channel: ' + message.text);
            if (message.text === 'still here') {
                done();
            }
        });
    });

    it('sends a reaction without a reply id of its own (#10)', function(done) {
        var lines = [];
        server = startBridge([':erin!e@h NOTICE #chan :ready'], function(message) {
            if (message.text !== 'ready') {
                return;
            }
            var channel = config.channels[0];
            var reaction = '<alice> reacted 👍 to $beef';
            server.irc.send({protocol: 'tg', channel: channel, id: 'f00d',
                type: 'reaction', text: reaction});
            server.irc.send({protocol: 'tg', channel: channel, id: 'cafe', text: '<alice> hi'});
        });
        server.onPrivmsg = function(line) {
            lines.push(line);
            if (lines.length === 2) {
                assert.deepStrictEqual(lines, [
                    'PRIVMSG #chan :<alice> reacted 👍 to $beef',
                    'PRIVMSG #chan :<alice> hi $cafe'
                ]);
                done();
            }
        };
    });

    it('sends a long ASCII line as one PRIVMSG per delay', function(done) {
        var times = [];
        server = startBridge([':erin!e@h NOTICE #chan :ready'], function(message) {
            if (message.text === 'ready') {
                server.irc.send({channel: config.channels[0], text: 'a'.repeat(1000)}, true);
            }
        });
        server.onPrivmsg = function(line) {
            times.push(Date.now());
            assert.ok(line.length - 'PRIVMSG #chan '.length <= 351, line.length);
            // 1000 characters are 3 blocks: 350, 350 and 300.
            if (times.length === 3) {
                assert.ok(times[1] - times[0] >= 45, 'gap 1: ' + (times[1] - times[0]));
                assert.ok(times[2] - times[1] >= 45, 'gap 2: ' + (times[2] - times[1]));
                done();
            }
        };
    });

    it('cuts a long line into blocks of at most 350 bytes, one delay apart', function(done) {
        var lines = [];
        var times = [];
        server = startBridge([':erin!e@h NOTICE #chan :ready'], function(message) {
            if (message.text === 'ready') {
                server.irc.send({channel: config.channels[0], text: '時'.repeat(300)}, true);
            }
        });
        server.onPrivmsg = function(line) {
            lines.push(line.replace(/^PRIVMSG #chan :?/, ''));
            times.push(Date.now());
            if (lines.length === 3) {
                // 900 bytes in blocks of at most 350 bytes (116 characters).
                assert.strictEqual(lines.join(''), '時'.repeat(300));
                lines.forEach(function(text) {
                    assert.ok(Buffer.byteLength(text) <= 350, Buffer.byteLength(text));
                });
                assert.ok(times[2] - times[1] >= 45, 'gap: ' + (times[2] - times[1]));
                done();
            }
        };
    });

    it('never writes a CR or LF inside a PRIVMSG', function(done) {
        server = startBridge([':erin!e@h NOTICE #chan :ready'], function(message) {
            if (message.text === 'ready') {
                server.irc.send({channel: config.channels[0], text: 'hi\rQUIT :bye'}, true);
            }
        });
        server.onPrivmsg = function(line) {
            // The fake server splits on LF and strips one CR at the end, so a
            // CR inside would show up here, and a LF would make a 2nd command.
            assert.strictEqual(line, 'PRIVMSG #chan :hi QUIT :bye');
            assert.ok(server.received.every(function(l) {
                return l.indexOf('QUIT') !== 0;
            }));
            done();
        };
    });

    it('drops the oldest lines when the queue is full', function(done) {
        var savedMax = config.ircQueueMax;
        config.ircQueueMax = 2;
        var lines = [];
        server = startBridge([':erin!e@h NOTICE #chan :ready'], function(message) {
            if (message.text === 'ready') {
                // a goes out at once; b, c and d wait, and only 2 of them fit.
                server.irc.send({channel: config.channels[0], text: 'a\nb\nc\nd'}, true);
            }
        });
        server.onPrivmsg = function(line) {
            lines.push(line);
            if (lines.length === 3) {
                config.ircQueueMax = savedMax;
                // irc-framework writes no ':' before a one-word last parameter.
                assert.deepStrictEqual(lines, ['PRIVMSG #chan a', 'PRIVMSG #chan c',
                    'PRIVMSG #chan d']);
                done();
            }
        };
    });

    it('paces two messages as one queue, and sends at once after it is idle',
        function(done) {
            var times = [];
            var channel = config.channels[0];
            server = startBridge([':erin!e@h NOTICE #chan :ready'], function(message) {
                if (message.text === 'ready') {
                    server.irc.send({channel: channel, text: 'a'}, true);
                    server.irc.send({channel: channel, text: 'b'}, true);
                    // After two delays the queue is idle again.
                    setTimeout(function() {
                        times.push('idle');
                        server.irc.send({channel: channel, text: 'c'}, true);
                    }, 150);
                }
            });
            server.onPrivmsg = function() {
                times.push(Date.now());
                if (times.length === 4) {
                    assert.ok(times[1] - times[0] >= 45, 'gap a-b: ' + (times[1] - times[0]));
                    // c goes out at once, not one delay after the idle point.
                    assert.ok(times[3] - times[1] < 200, 'c late: ' + (times[3] - times[1]));
                    done();
                }
            };
        });

    it('sends the lines of a long message one delay apart', function(done) {
        var times = [];
        server = startBridge([':erin!e@h NOTICE #chan :ready'], function(message) {
            if (message.text === 'ready') {
                server.irc.send({channel: config.channels[0], text: 'a\nb\nc'}, true);
            }
        });
        server.onPrivmsg = function() {
            times.push(Date.now());
            if (times.length === 3) {
                // 45, not 50: a timer can fire a little early.
                assert.ok(times[1] - times[0] >= 45, 'gap 1: ' + (times[1] - times[0]));
                assert.ok(times[2] - times[1] >= 45, 'gap 2: ' + (times[2] - times[1]));
                done();
            }
        };
    });
});
