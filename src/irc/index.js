var NodeIrc = require('irc-framework');
var config = require('../config');
var ircUtil = require('./util');
var logger = require('winston');
var _ = require('lodash');
var M = require('../message');

var shouldRelayEvent = function(event) {
    if (_.isArray(config.relayIRCEvents)) {
        // Using the new array format
        if (config.relayIRCEvents.indexOf(event) !== -1) {
            return true;
        }

        return false;
    } else {
        // Using the old boolean format and warn

        logger.warn('config.sendTopic and config.sendNonMsg were merged into ' +
            'config.relayIRCEvents. You are either using one of them, or passing a boolean ' +
            '(true/false) to config.relayIRCEvents. Please migrate to config.relayIRCEvents, ' +
            'and pass an array of the desired IRC events to relay. See the default config for an ' +
            'example: ' +
            'https://github.com/FruitieX/teleirc/blob/develop/src/config.defaults.js '
        );

        return true;
    }
};

var init = function(msgCallback) {
    var nodeIrc = new NodeIrc.Client();
    nodeIrc.connect({
        host: config.ircServer,
        nick: config.ircNick,
        port: config.ircOptions.port,
        tls: config.ircOptions.secure,
        password: config.ircOptions.password,
        username: config.ircOptions.userName,
        gecos: config.ircOptions.realName,
    });

    nodeIrc.on('error', function(error) {
        logger.error('unhandled IRC error:', error);
    });

    nodeIrc.on('registered', function(event) {
        // Mark the bridge as a bot (IRCv3 bot mode). Libera.Chat forbids a
        // change of this mode while the client is in a channel, so it must go
        // before the JOINs. Do not gate it on ISUPPORT BOT: 'registered' fires
        // on 001, before the server sends 005. A server without +B answers
        // with an error numeric, which is harmless. Use the nick from 001:
        // nodeIrc.user.nick still holds the requested nick at this point.
        nodeIrc.raw('MODE', event.nick, '+B');
        // IRC perform on connect
        config.ircPerformCmds.forEach(function(cmd) {
            nodeIrc.raw.apply(nodeIrc, cmd.split(' '));
        });
        config.channels.forEach(function(channel) {
            nodeIrc.join(channel.ircChan, channel.chanPwd);
        });
    });

    nodeIrc.on('privmsg', function(event) {
        if (!shouldRelayEvent('message')) {
            return;
        }

        var user = event.nick;
        var chanName = event.target;
        var text = event.message;
        if (ircUtil.checkIgnore(user, text)) {
            return;
        }

        var message = ircUtil.parseMsg(chanName, text);

        if (message) {
            var channel = ircUtil.lookupChannel(chanName, config.channels);
            var ircChanReadOnly = channel.ircChanReadOnly;
            var isOverrideReadOnly = channel.ircChanOverrideReadOnly;
            var isBotHighlighted = config.hlRegexp.exec(message.text);
            var match = isBotHighlighted;

            if (match && config.hlOnlyShowMatch) {
                message.text = match[1];
            }

            if (ircChanReadOnly) {
                if (!(isOverrideReadOnly && isBotHighlighted)) {
                    return;
                }
            }

            logger.debug('got irc msg:', message);
            msgCallback({
                original: {
                    user: user,
                    chanName: chanName,
                    text: text
                },
                protocol: 'irc',
                channel: message.channel,
                user: user,
                text: message.text,
                replyTo: message.replyTo
            });
        }
    });

    nodeIrc.on('notice', function(event) {
        if (!shouldRelayEvent('notice')) {
            return;
        }

        var user = event.nick;
        var chanName = event.target;
        var text = event.message;
        if (ircUtil.checkIgnore(user, text)) {
            return;
        }

        var notice = ircUtil.parseMsg(chanName, text);

        if (notice) {
            var channel = ircUtil.lookupChannel(chanName, config.channels);
            var ircChanReadOnly = channel.ircChanReadOnly;
            var isOverrideReadOnly = channel.ircChanOverrideReadOnly;
            var isBotHighlighted = config.hlRegexp.exec(notice.text);
            var match = isBotHighlighted;

            if (match && config.hlOnlyShowMatch) {
                notice.text = match[1];
            }

            if (ircChanReadOnly) {
                if (!(isOverrideReadOnly && isBotHighlighted)) {
                    return;
                }
            }

            logger.debug('got irc msg:', notice);
            msgCallback({
                original: {
                    user: user,
                    chanName: chanName,
                    text: text
                },
                protocol: 'irc',
                channel: notice.channel,
                user: user,
                text: notice.text,
                replyTo: notice.replyTo
            });
        }
    });

    nodeIrc.on('action', function(event) {
        if (!shouldRelayEvent('action')) {
            return;
        }

        var user = event.nick;
        var chanName = event.target;
        var text = event.message;

        var message = ircUtil.parseMsg(chanName, text);

        if (message) {
            var messageText = user + ': ' + message.text;
            if (config.emphasizeAction) {
                messageText = '* ' + messageText + ' *';
            }

            msgCallback({
                original: {
                    user: user,
                    chanName: chanName,
                    text: text
                },
                protocol: 'irc',
                type: 'action',
                channel: message.channel,
                user: null,
                text: message.text,
                replyTo: message.replyTo
            });
        }
    });

    nodeIrc.on('topic', function(event) {
        if (!shouldRelayEvent('topic')) {
            return;
        }

        var chanName = event.channel;
        var topic = event.topic;
        var user = event.nick || '';

        var message = ircUtil.parseTopic(chanName, topic, user);

        if (message) {
            msgCallback({
                original: {
                    chanName: chanName,
                    topic: topic,
                    user: user
                },
                protocol: 'irc',
                type: 'topic',
                channel: message.channel,
                user: null,
                text: message.text
            });
        }
    });

    nodeIrc.on('join', function(event) {
        if (!shouldRelayEvent('join')) {
            return;
        }

        var chanName = event.channel;
        var user = event.nick;
        var text = '';

        var channel = ircUtil.lookupChannel(chanName, config.channels);
        if (!channel) {
            return;
        }
        msgCallback({
            original: {
                chanName: chanName,
                user: user,
                text: text
            },
            protocol: 'irc',
            type: 'join',
            channel: channel,
            user: null,
            text: user + ' has joined'
        });
    });

    nodeIrc.on('part', function(event) {
        if (!shouldRelayEvent('part')) {
            return;
        }

        var chanName = event.channel;
        var user = event.nick;
        var text = '';

        var channel = ircUtil.lookupChannel(chanName, config.channels);
        if (!channel) {
            return;
        }
        msgCallback({
            original: {
                chanName: chanName,
                user: user,
                text: text
            },
            protocol: 'irc',
            type: 'part',
            channel: channel,
            user: null,
            text: user + ' has left'
        });
    });

    nodeIrc.on('kick', function(event) {
        if (!shouldRelayEvent('kick')) {
            return;
        }

        var chanName = event.channel;
        var user = event.kicked;
        var by = event.nick;
        var reason = event.message;

        var channel = ircUtil.lookupChannel(chanName, config.channels);
        if (!channel) {
            return;
        }
        msgCallback({
            original: {
                chanName: chanName,
                user: user,
                by: by,
                reason: reason
            },
            protocol: 'irc',
            type: 'part',
            channel: channel,
            user: null,
            text: user + ' was kicked by ' + by + ' (' + reason + ')',
        });
    });

    // new framework doesn't provide the channels....
    nodeIrc.on('quit', function(user, text, channels, message) {
        return;
    });

    // added since framework does not have async
    // method to return nicklist
    nodeIrc.on('wholist', function(event) {
        var channel = ircUtil.lookupChannel(event.target, config.channels);
        // irc-framework emits wholist for every end of a WHO reply, also for
        // a WHO that the bot did not send for a bridged channel.
        if (!channel) {
            return;
        }
        var users = event.users.reduce(function(usersStr, user) {
            if (usersStr === '') {
                return user.nick;
            }
            return usersStr + ', ' + user.nick;
        }, '');
        msgCallback({
            original: event,
            protocol: 'irc',
            channel: channel,
            user: '',
            text: 'Users in ' + event.target + ':\n\n' + users
        });
    });

    // irc-framework sends at once and has no flood control, and a burst of
    // lines makes the server drop the connection (a 62-line message did, on
    // 2026-11-07). So send one PRIVMSG per floodProtectionDelay. Every PRIVMSG
    // must go through say(), and say() cuts a long line itself, so that
    // irc-framework never sends more than one PRIVMSG for a queued block.
    var queue = [];
    var timer = null;
    var drain = function() {
        var line = queue.shift();
        if (!line) {
            timer = null;
            return;
        }
        // Set the timer first, so that the queue state stays right when a
        // caller catches a throw from say().
        timer = setTimeout(drain, config.ircOptions.floodProtectionDelay);
        nodeIrc.say(line.target, line.text);
    };
    var say = function(target, text) {
        M.splitBytes(text, M.IRC_LINE_BYTES).forEach(function(block) {
            queue.push({target: target, text: block});
        });
        // A full queue keeps the newest lines: the oldest are the most out of
        // date, and a line waits at most ircQueueMax * floodProtectionDelay.
        var dropped = queue.splice(0, Math.max(0, queue.length - config.ircQueueMax));
        if (dropped.length) {
            logger.warn('IRC queue full, dropped ' + dropped.length + ' lines');
        }
        if (!timer) {
            drain();
        }
    };

    return {
        send: function(message, multi) {
            if (multi) {
                logger.verbose('<< relaying to IRC w/ multiple lines:', message.text);
                message.text.split('\n').forEach(function(msg) {
                    say(message.channel.ircChan, msg);
                });
                return;
            }

            ircUtil.ircLines(message).forEach(function(line) {
                logger.verbose('<< relaying to IRC:', line);
                say(message.channel.ircChan, line);
            });
        },
        getNames: function(channel) {
            nodeIrc.who(channel.ircChan);
            return null;
        },
        getTopic: function(channel) {
            nodeIrc.raw('TOPIC ' + channel.ircChan);
            return null;
            //var topic = ircUtil.getTopic(nodeIrc.chans[channel.ircChan.toLowerCase()]);
            //return ircUtil.topicFormat(channel, topic.text, topic.topicBy);
        }
    };
};

module.exports = init;
