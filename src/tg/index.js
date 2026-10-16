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

            // The text of every message is plain text. Markup is added here and
            // only here, after the escape, so no text can break the parse mode.
            // message.text is not changed: a broadcast sends it to IRC too.
            // An action (type 'action') gives its nick in message.original.user.
            var text = message.text;
            var fallbackText = tgUtil.stripIrcCodes(text);
            if (parseMode === 'html') {
                text = tgUtil.escapeHtml(text);
            }

            var replyId = M.get(message.replyTo);
            if (replyId) {
                text = text.replace(M.ID_FORMAT, '');
                fallbackText = fallbackText.replace(M.ID_FORMAT, '');
            }

            if (message.type === 'action') {
                fallbackText = '* ' + message.original.user + ' ' + fallbackText;
                text = tgUtil.formatAction(config, message.original.user) + ' ' + text;
            } else if (message.user) {
                fallbackText = '<' + message.user + '> ' + fallbackText;
                text = tgUtil.formatNick(config, message.user) + ' ' + text;
            }

            // ponytail: fixMarkdown also sees the prefix, so a nick with '_'
            // breaks the bold of "*nick*" and Telegram shows the asterisks.
            // Production uses html. For markdown, fix the text before the prefix,
            // after a check of how the Bot API reads '_' in bold.
            if (parseMode === 'markdown') {
                text = tgUtil.fixMarkdown(text);
            }

            logger.verbose('>> relaying to TG:', text);
            tg.sendMessage(
                message.channel.tgChatId,
                tgUtil.stripIrcCodes(text),
                {
                    parse_mode: parseMode,
                    reply_to_message_id: replyId
                }
            )
                .catch(function(err) {
                    logger.error(err);
                    // resend
                    logger.verbose('>> fallback to plain text');
                    return tg.sendMessage(message.channel.tgChatId, fallbackText, {
                        reply_to_message_id: replyId
                    });
                });
        }
    };
};

module.exports = init;
