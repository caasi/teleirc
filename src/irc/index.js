var NodeIrc = require('irc');
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
    config.ircOptions.channels = ircUtil.getChannels(config.channels);

    var nodeIrc = new NodeIrc.Client(config.ircServer, config.ircNick, config.ircOptions);
    nodeIrc.on('error', function(error) {
        logger.error('unhandled IRC error:', error);
    });

    nodeIrc.on('registered', function() {
        // IRC perform on connect
        config.ircPerformCmds.forEach(function(cmd) {
            nodeIrc.send.apply(null, cmd.split(' '));
        });
    });

    nodeIrc.on('message', function(user, chanName, text) {
        if (!shouldRelayEvent('message')) {
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

    nodeIrc.on('notice', function(user, chanName, text) {
        if (!shouldRelayEvent('notice')) {
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
                replyTo: message.replyTo
            });
        }
    });

    nodeIrc.on('action', function(user, chanName, text) {
        if (!shouldRelayEvent('action')) {
            return;
        }

        var message = ircUtil.parseMsg(chanName, text);
        var formatted;

        if (config.emNick && config.parseMode === 'markdown') {
          formatted = '\\* *' + user + '* ' + message.text;
        } else if (config.emNick && config.parseMode === 'html') {
          formatted = '* <b>' + user + '</b> ' + message.text;
        } else {
          formatted = '* ' + user + ' ' + message.text;
        }

        if (message) {
            var messageText = user + ': ' + message.text;
            if (config.emphasizeAction) {
                messageText = '*' + messageText + '*';
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
                text: formatted,
                replyTo: message.replyTo
            });
        }
    });

    nodeIrc.on('topic', function(chanName, topic, user) {
        if (!shouldRelayEvent('topic')) {
            return;
        }

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

    nodeIrc.on('join', function(chanName, user, text) {
        if (!shouldRelayEvent('join')) {
            return;
        }

        var channel = ircUtil.lookupChannel(chanName, config.channels);
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

    nodeIrc.on('part', function(chanName, user, text) {
        if (!shouldRelayEvent('part')) {
            return;
        }

        var channel = ircUtil.lookupChannel(chanName, config.channels);
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

    nodeIrc.on('kick', function(chanName, user, by, reason) {
        if (!shouldRelayEvent('kick')) {
            return;
        }

        var channel = ircUtil.lookupChannel(chanName, config.channels);
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

    nodeIrc.on('quit', function(user, text, channels, message) {
        if (!shouldRelayEvent('quit')) {
            return;
        }

        for (var i = 0; i < channels.length; i++) {
            var reason = '';
            if (text) {
                reason = ' (' + text + ')';
            }

            var channel = ircUtil.lookupChannel(channels[i], config.channels);
            msgCallback({
                original: {
                    user: user,
                    text: text,
                    channels: channels,
                    message: message
                },
                protocol: 'irc',
                type: 'quit',
                channel: channel,
                user: null,
                text: user + ' has quit' + reason
            });
        }
    });

    return {
        send: function(message, raw) {
            var text = ''

            if (!raw) {
                // strip empty lines
                message.text = message.text.replace(/^\s*\n/gm, '');

                // replace newlines
                message.text = message.text.replace(/\n/g, config.replaceNewlines);

                // TODO: replace here any remaining newlines with username
                // (this can happen if user configured replaceNewlines to itself
                // contain newlines)
            }

            // append the message id
            if (message && message.id) {
                message.text += ' $' + message.id;
            }

            // show a part of the reply message
            if (message && message.original && message.original.reply_to_message && message.original.reply_to_message.text) {
                text = message.original.reply_to_message.text.replace(M.NICK_FORMAT, '')
                message.text += ' (' + text.substr(0, 5) + '…)';
            }

            logger.verbose('<< relaying to IRC:', message.text);
            nodeIrc.say(message.channel.ircChan, message.text);
        },
        getNames: function(channel) {
            return ircUtil.getNames(nodeIrc.chans[channel.ircChan.toLowerCase()]);
        },
        getTopic: function(channel) {
            var topic = ircUtil.getTopic(nodeIrc.chans[channel.ircChan.toLowerCase()]);
            return ircUtil.topicFormat(channel, topic.text, topic.topicBy);
        }
    };
};

module.exports = init;
