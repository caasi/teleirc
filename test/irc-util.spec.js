'use strict';

var assert = require('assert');

require('./helpers/sandbox');

var ircUtil = require('../src/irc/util');

// Each case is [input, expected]. The expected values are what parseUrl
// returned when these tests were written. The inputs come from a manual
// check script kept on the production host since 2018.
var cases = require('./parse-url-cases.json');

describe('irc/util parseUrl', function() {
    cases.forEach(function(c) {
        it('simplifies ' + c[1].type + ': ' + c[1].url, function() {
            assert.deepStrictEqual(ircUtil.parseUrl(c[0]), c[1]);
        });
    });
});

describe('irc/util ircLines', function() {
    var nl = {replaceNewlines: '\n'};
    var joined = {replaceNewlines: ' … '};
    var reply = function(text) {
        return {reply_to_message: {text: text}};
    };

    it('joins the lines, adds the $id and the reply, and simplifies URLs', function() {
        assert.deepStrictEqual(ircUtil.ircLines({text: '<a> x\n\ny', id: 'ab12'}, joined),
            ['<a> x … y $ab12']);
        assert.deepStrictEqual(ircUtil.ircLines({text: '<a> x', id: 'ab12',
            original: reply('<b> hello world, a long one')}, joined),
            ['<a> x $ab12 (hello worl…)']);
        assert.deepStrictEqual(ircUtil.ircLines({text: '<a> x',
            original: reply('https://example.com/p?utm_source=t')}, joined),
            ['<a> x <https://example.com/p>']);
    });

    it('gives a reaction no $id', function() {
        assert.deepStrictEqual(ircUtil.ircLines({text: '<a> reacted 👍 to $beef', id: 'ab12',
            type: 'reaction'}, joined), ['<a> reacted 👍 to $beef']);
    });

    it('puts the nick on each line, and no line is only the nick', function() {
        assert.deepStrictEqual(ircUtil.ircLines({text: '<a> \nx\ny', id: 'ab12', prefix: '<a> '},
            nl),
            ['<a> x', '<a> y $ab12']);
    });

    it('repeats a display name that holds a space or colour codes', function() {
        assert.deepStrictEqual(ircUtil.ircLines({text: '<Ann Lee> one\ntwo', prefix: '<Ann Lee> '},
            nl), ['<Ann Lee> one', '<Ann Lee> two']);
        var coloured = '<\u000311\u0002\u0002Ann Lee\u0003> ';
        assert.deepStrictEqual(ircUtil.ircLines({text: coloured + 'one\ntwo', prefix: coloured},
            nl), [coloured + 'one', coloured + 'two']);
    });

    it('keeps a text with no nick whole, without a prefix', function() {
        assert.deepStrictEqual(ircUtil.ircLines({text: 'a'}, nl), ['a']);
        // Text that looks like a nick is text when there is no prefix.
        assert.deepStrictEqual(ircUtil.ircLines({text: '< 5 > one\ntwo', prefix: ''}, nl),
            ['< 5 > one', 'two']);
        assert.deepStrictEqual(ircUtil.ircLines({text: '<b>bold</b> x\ny'}, nl),
            ['<b>bold</b> x', 'y']);
        assert.deepStrictEqual(ircUtil.ircLines({text: 'ab\ncd'}, nl), ['ab', 'cd']);
        assert.deepStrictEqual(ircUtil.ircLines({text: 'no nick',
            original: reply('https://example.com/p')}, nl), ['no nick <https://example.com/p>']);
    });
});
