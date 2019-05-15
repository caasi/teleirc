var Telegram = require('tgfancy');
var config = require('../config');
var tgUtil = require('./util');
var logger = require('winston');
var M = require('../message');

var myUser = {};

var init = function(msgCallback) {
    // start HTTP server for media files if configured to do so
    if (config.showMedia) {
        tgUtil.initHttpServer();
    }

    var tg = new Telegram(config.tgToken, {
        polling: true,
        emojification: true,
    });

    // get our own Telegram user
    tg.getMe().then(function(me) {
        myUser = me;

        var recieveMessage = function(msg) {
            logger.debug('got tg msg:', msg);

            tgUtil.parseMsg(msg, myUser, tg, function(message) {
                if (message) {
                    var tgGroupReadOnly = message.channel.tgGroupReadOnly;
                    var isOverrideReadonly = message.channel.tgGroupOverrideReadOnly;
                    var isBotHighlighted = false;

                    isBotHighlighted = msg.text && msg.text.startsWith('@' + myUser.username);

                    if (tgGroupReadOnly) {
                        if (!(isOverrideReadonly && isBotHighlighted)) {
                            return;
                        }
                    }

                    message.original = msg;
                    message.protocol = 'tg';
                    msgCallback(message);
                }
            });
        };

        tg.on('message', recieveMessage);
        if (config.relayEdited) {
            tg.on('edited_message', recieveMessage);
        }
    }).catch(function(err) {
      console.error(err);
    });

    return {
        send: function(message) {
            // if no chatId has been read for the chat yet, try reading it from disk
            if (!message.channel.tgChatId) {
                message.channel.tgChatId = tgUtil.readChatId(message.channel);
            }

            // if still no chatId, return with error message
            if (!message.channel.tgChatId) {
                var err = 'No chat_id set! Add me to a Telegram group ' +
                          'and say hi so I can find your group\'s chat_id!';

                msgCallback({
                    protocol: 'tg',
                    channel: message.channel,
                    text: err
                });

                logger.error(err);
                return;
            }

            var parseMode = config.parseMode;
            if (parseMode !== 'markdown' && parseMode !== 'html') {
                parseMode = undefined;
            }

            var fallbackText = tgUtil.stripIrcCodes(message.text) || '';
            if (message.user) {
                var nick;

                // save the message to fallback to plain text
                fallbackText = '<' + message.user + '> ' + message.text;

                nick = tgUtil.formatNick(config, message.user);
                message.text = nick + ' ' + message.text;

                if (parseMode === 'markdown') {
                    message.text = tgUtil.fixMarkdown(message.text);
                }
            }

            var replyId = M.get(message.replyTo);
            if (replyId) {
                message.text = message.text.replace(M.ID_FORMAT, '');
            }

            logger.verbose('>> relaying to TG:', message.text);
            tg.sendMessage(
                message.channel.tgChatId,
                tgUtil.stripIrcCodes(message.text),
                {
                    parse_mode: parseMode,
                    reply_to_message_id: replyId
                }
            )
                .catch(function(err) {
                    logger.error(err);
                    // resend
                    logger.verbose('>> fallback to plain text');
                    return tg.sendMessage(message.channel.tgChatId, fallbackText);
                });
        }
    };
};

module.exports = init;
