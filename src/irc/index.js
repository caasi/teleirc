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
    config.ircOptions.channels = ircUtil.getChannels(config.channels);

    var nodeIrc = new NodeIrc.Client();
    nodeIrc.connect({
        host: config.ircServer,
        nick: config.ircNick,
        port: config.ircOptions.port,
        tls: config.ircOptions.secure
    });

    nodeIrc.on('error', function(error) {
        logger.error('unhandled IRC error:', error);
    });

    var MESSAGE_DELAY = 100;
    var say = function(channel, messages) {
      var m = messages[0];
      var ms = messages.slice(1);

      if (m === undefined) return;

      try {
        nodeIrc.say(channel, m);
        setTimeout(say, MESSAGE_DELAY, channel, ms);
      } catch (error) {
        // log the error and try again
        logger.error('handled IRC error:', error);
        setTimeout(say, MESSAGE_DELAY, channel, messages);
      }
    };

    nodeIrc.on('registered', function() {
        // IRC perform on connect
        config.ircPerformCmds.forEach(function(cmd) {
            nodeIrc.raw.apply(nodeIrc, cmd.split(' '));
        });
        config.ircOptions.channels.forEach(function(channel) {
            nodeIrc.join(channel);
        });
    });

    nodeIrc.on('message', function(event) {
        if (!shouldRelayEvent('message')) {
            return;
        }

        var user = event.nick;
        var chanName = event.target;
        var text = event.message;

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

    nodeIrc.on('action', function(event) {
        if (!shouldRelayEvent('action')) {
            return;
        }

        var user = event.nick;
        var chanName = event.target;
        var text = event.message;

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
        var users = event.users.reduce(function(usersStr, user) {
            if (usersStr === '') {
                return user.nick;
            }
            return usersStr + ', ' + user.nick;
        }, '');
        msgCallback({
            original: {
                user: user,
                text: text,
                channels: channels,
                message: message
            },
            protocol: 'irc',
            channel: channel,
            user: '',
            text: 'Users in ' + event.target + ':\n\n' + users
        });
    });

    return {
        send: function(message, raw) {
            var text = ''

            if (!raw) {
                // strip empty lines
                message.text = message.text.replace(/^\s*\n/gm, '');

                // replace newlines
                message.text = message.text.replace(/\n/g, config.replaceNewlines);

                // simplify URLs
                message.text = message.text.replace(/https?:\/\/\S*/g, function(match) {
                    return ircUtil.parseUrl(match).url;
                });

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
                if( text.match(/^\s*https?:\/\//) )
                    message.text += ' <' + ircUtil.parseUrl(text.match(/https?:\/\/\S*/)[0]).url + '>'
                else
                    message.text += ' (' + text.substr(0, 10) + '…)';
            }

            logger.verbose('<< relaying to IRC:', message.text);
            say(message.channel.ircChan, message.text.split('\n'));
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
